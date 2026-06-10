/**
 * comparators.test.ts — the three deterministic checks.
 *
 * Expectations are grounded in eval/fixtures/cases.json and the CFR tolerances (independent of
 * the implementation): pass cases, review cases, every failure mode, and one case per beverage
 * class proving the class SELECTS the right tolerance.
 */
import { describe, it, expect } from "vitest";
import {
  compareBrand,
  compareAlcohol,
  compareWarning,
  compareNetContents,
  compareClassType,
  compareName,
  compareAddress,
  compareOrigin,
  compareFancifulName,
  compareStatementOfComposition,
} from "./comparators";
import { CANONICAL_GOVERNMENT_WARNING } from "@/domain";

describe("compareBrand", () => {
  it("PASS: smart-quote + case differences normalize away", () => {
    const r = compareBrand({ claimed: "Stone’s Throw", extracted: "STONE’S THROW" });
    expect(r.status).toBe("pass");
  });
  it("REVIEW: a genuine one-character typo is close but not identical", () => {
    const r = compareBrand({ claimed: "Old Tom Distillery", extracted: "Old Tomm Distillery" });
    expect(r.status).toBe("review");
  });
  it("REVIEW: brand mark vs producer name ('ABC' vs 'ABC Distillery') — not a hard fail", () => {
    // The model wavers between the fanciful mark and the producer on labels that print both; this
    // must not flap to Reject. Both directions resolve to a close match -> review.
    expect(compareBrand({ claimed: "ABC", extracted: "ABC Distillery" }).status).toBe("review");
    expect(compareBrand({ claimed: "ABC Distillery", extracted: "ABC" }).status).toBe("review");
  });
  it("REVIEW: one brand contains the other ('ABC' vs 'ABC Single Barrel')", () => {
    expect(compareBrand({ claimed: "ABC", extracted: "ABC Single Barrel" }).status).toBe("review");
  });
  it("PASS: identical brand with a producer suffix stays a pass", () => {
    expect(compareBrand({ claimed: "Old Tom Distillery", extracted: "OLD TOM DISTILLERY" }).status).toBe("pass");
  });
  it("REVIEW: a symbol-only difference is not an auto-pass ('Smith & Co' vs 'Smith Co')", () => {
    expect(compareBrand({ claimed: "Smith & Co", extracted: "Smith Co" }).status).toBe("review");
    expect(compareBrand({ claimed: "St. George", extracted: "St George" }).status).toBe("review");
  });
  it("FAIL: a different brand", () => {
    const r = compareBrand({ claimed: "Old Tom Distillery", extracted: "New Barrel Co" });
    expect(r.status).toBe("fail");
  });
  it("FAIL: nothing read for the brand", () => {
    const r = compareBrand({ claimed: "Old Tom Distillery", extracted: "" });
    expect(r.status).toBe("fail");
  });
});

describe("compareWarning", () => {
  const ok = {
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true as boolean | null,
  };

  it("PASS: canonical text, all-caps bold prefix", () => {
    expect(compareWarning(ok).status).toBe("pass");
  });
  it("PASS: bold undetectable (null) is not a violation", () => {
    expect(compareWarning({ ...ok, warningPrefixIsBold: null }).status).toBe("pass");
  });
  it("FAIL: title-case prefix (warningPrefixIsAllCaps=false), body otherwise verbatim", () => {
    const r = compareWarning({
      warningText:
        "Government Warning: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
      warningPrefixIsAllCaps: false,
      warningPrefixIsBold: true,
    });
    expect(r.status).toBe("fail");
    expect(r.reason.toLowerCase()).toContain("capital");
  });
  it("FAIL: prefix detectably not bold", () => {
    expect(compareWarning({ ...ok, warningPrefixIsBold: false }).status).toBe("fail");
  });
  it("FAIL: reworded warning", () => {
    const r = compareWarning({
      warningText: "GOVERNMENT WARNING: Drinking is bad for you.",
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: true,
    });
    expect(r.status).toBe("fail");
  });
  it("FAIL: missing warning", () => {
    const r = compareWarning({ warningText: "", warningPrefixIsAllCaps: false, warningPrefixIsBold: false });
    expect(r.status).toBe("fail");
    expect(r.reason.toLowerCase()).toContain("missing");
  });
  it("PASS (exempt): product under 0.5% ABV needs no warning", () => {
    const r = compareWarning({ warningText: "", warningPrefixIsAllCaps: false, warningPrefixIsBold: null, abv: 0.4 });
    expect(r.status).toBe("pass");
    expect(r.reason).toContain("0.5%");
  });

  it("REVIEW: lowercase 'surgeon general' — the S and G must be capitalized (TTB checklist; 27 CFR 16.21)", () => {
    // Wording matches verbatim case-insensitively, but the case-fold would otherwise hide this format
    // defect entirely. Review (not fail): mid-sentence case is read from raw OCR text, where a case
    // misread is plausible — a human confirms, the label is never auto-approved.
    const r = compareWarning({
      warningText: CANONICAL_GOVERNMENT_WARNING.replace("Surgeon General", "surgeon general"),
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: true,
    });
    expect(r.status).toBe("review");
    expect(r.reason).toContain("Surgeon General");
  });
  it("PASS: a fully-capitalized warning satisfies the Surgeon General capitalization rule", () => {
    const r = compareWarning({
      warningText: CANONICAL_GOVERNMENT_WARNING.replace("Surgeon General", "SURGEON GENERAL"),
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: true,
    });
    expect(r.status).toBe("pass");
  });
});

describe("compareAlcohol — fixture-grounded", () => {
  it("PASS: 45% claimed vs 45% (90 proof) extracted, spirits", () => {
    const r = compareAlcohol({
      claimedText: "45% Alc./Vol. (90 Proof)",
      extractedText: "45% Alc./Vol. (90 Proof)",
      claimedClass: "distilled-spirits",
    });
    expect(r.status).toBe("pass");
  });
  it("FAIL: 45% claimed vs 46% (92 proof) extracted exceeds ±0.3 spirits tolerance", () => {
    const r = compareAlcohol({
      claimedText: "45% Alc./Vol. (90 Proof)",
      extractedText: "46% Alc./Vol. (92 Proof)",
      claimedClass: "distilled-spirits",
    });
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("5.65");
  });
  it("PASS: proof absent (real-image case) — no cross-check required", () => {
    const r = compareAlcohol({
      claimedText: "45% Alc./Vol.",
      extractedText: "45% Alc./Vol.",
      claimedClass: "distilled-spirits",
    });
    expect(r.status).toBe("pass");
  });
  it("REVIEW: label proof inconsistent with its own ABV", () => {
    const r = compareAlcohol({
      claimedText: "45% Alc./Vol.",
      extractedText: "45% Alc./Vol. (80 Proof)", // 80 ≠ 2×45
      beverageClass: "distilledSpirits",
    });
    expect(r.status).toBe("review");
  });
  it("REVIEW: alcohol unreadable on the label", () => {
    const r = compareAlcohol({
      claimedText: "45% Alc./Vol.",
      extractedText: "",
      beverageClass: "distilledSpirits",
    });
    expect(r.status).toBe("review");
  });
  it("FAIL (false-approval guard): a misleading '100% Agave' is not read as the ABV", () => {
    // Both sides print "100% Agave" before the real ABV (40 vs 38). Anchoring to the alcohol cue
    // compares 40 vs 38 (out of the ±0.3 band -> fail), not 100 vs 100 (which would falsely approve).
    const r = compareAlcohol({
      claimedText: "100% Agave. 40% Alc./Vol. (80 Proof)",
      extractedText: "100% Agave. 38% Alc./Vol. (76 Proof)",
      claimedClass: "Tequila",
    });
    expect(r.status).toBe("fail");
  });
});

describe("compareAlcohol — the class SELECTS the tolerance (one case per class)", () => {
  it("distilledSpirits ±0.3: 40.3 passes, 40.4 fails", () => {
    expect(
      compareAlcohol({ claimedText: "40%", extractedText: "40.3%", beverageClass: "distilledSpirits" }).status,
    ).toBe("pass");
    expect(
      compareAlcohol({ claimedText: "40%", extractedText: "40.4%", beverageClass: "distilledSpirits" }).status,
    ).toBe("fail");
  });
  it("wineUnder14 ±1.5: 13.5 passes; 13.6 fails", () => {
    expect(
      compareAlcohol({ claimedText: "12%", extractedText: "13.5%", beverageClass: "wineUnder14" }).status,
    ).toBe("pass");
    expect(
      compareAlcohol({ claimedText: "12%", extractedText: "13.6%", beverageClass: "wineUnder14" }).status,
    ).toBe("fail");
  });
  it("wineUnder14 boundary: tolerance may not carry actual ABV above 14% (4.36(c))", () => {
    const r = compareAlcohol({ claimedText: "13.5%", extractedText: "14.6%", beverageClass: "wineUnder14" });
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("4.36(c)");
  });
  it("wineOver14 ±1.0: 15.9 passes; 16.1 fails", () => {
    expect(
      compareAlcohol({ claimedText: "15%", extractedText: "15.9%", beverageClass: "wineOver14" }).status,
    ).toBe("pass");
    expect(
      compareAlcohol({ claimedText: "15%", extractedText: "16.1%", beverageClass: "wineOver14" }).status,
    ).toBe("fail");
  });
  it("wineOver14 boundary: tolerance may not carry actual ABV to/below 14% (4.36(c))", () => {
    const r = compareAlcohol({ claimedText: "14.5%", extractedText: "14.0%", beverageClass: "wineOver14" });
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("4.36(c)");
  });
  it("maltBeverage ±0.3: 5.2 passes; 5.4 fails", () => {
    expect(
      compareAlcohol({ claimedText: "5%", extractedText: "5.2%", beverageClass: "maltBeverage" }).status,
    ).toBe("pass");
    expect(
      compareAlcohol({ claimedText: "5%", extractedText: "5.4%", beverageClass: "maltBeverage" }).status,
    ).toBe("fail");
  });
  it("maltBeverage 0.5% floor: labeled ≥0.5% may not actually be below 0.5% (7.65)", () => {
    const r = compareAlcohol({ claimedText: "0.5%", extractedText: "0.4%", beverageClass: "maltBeverage" });
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("7.65");
  });
  it("maltBeverage 2.5% low/reduced cap (7.65)", () => {
    const r = compareAlcohol({
      claimedText: "2.4%",
      extractedText: "2.6%",
      claimedClass: "Low Alcohol Malt Beverage",
      beverageClass: "maltBeverage",
    });
    expect(r.status).toBe("fail");
  });
  it("maltBeverage 2.5% cap fires from the LABEL's own 'low alcohol' designation (app class benign)", () => {
    // 27 CFR 7.65(d) ties the <2.5% cap to the label's designation — must fail even if the application
    // class is a plain "Malt Beverage".
    const r = compareAlcohol({
      claimedText: "4% Alc./Vol.",
      extractedText: "4% Alc./Vol.",
      claimedClass: "Malt Beverage",
      extractedClass: "Low Alcohol Malt Beverage",
    });
    expect(r.status).toBe("fail");
  });
  it("cider resolves to wine ±1.5 (NOT spirits ±0.3): 7.4 passes, 7.6 fails", () => {
    expect(
      compareAlcohol({ claimedText: "6%", extractedText: "7.4%", claimedClass: "Hard Cider" }).status,
    ).toBe("pass");
    expect(
      compareAlcohol({ claimedText: "6%", extractedText: "7.6%", claimedClass: "Hard Cider" }).status,
    ).toBe("fail");
  });
  it("cider boundary: tolerance may not carry actual ABV above 14% (4.36(c)), like wine ≤14%", () => {
    // Cider resolves to the wine (≤14%) tolerance, so it inherits the 4.36(c) clamp: a claimed 13%
    // cider reading 14.4% is within ±1.5 numerically but crosses the 14% tax-class boundary -> fail.
    const r = compareAlcohol({ claimedText: "13%", extractedText: "14.4%", claimedClass: "Hard Cider" });
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("4.36(c)");
  });
  it("unknown class uses the tightest band ±0.3: 40.2 passes, 40.4 fails", () => {
    expect(
      compareAlcohol({ claimedText: "40%", extractedText: "40.2%", beverageClass: "unknown" }).status,
    ).toBe("pass");
    expect(
      compareAlcohol({ claimedText: "40%", extractedText: "40.4%", beverageClass: "unknown" }).status,
    ).toBe("fail");
  });
});

describe("compareNetContents", () => {
  it("PASS: same metric volume, normalized spacing/case", () => {
    expect(compareNetContents({ claimed: "750 mL", extracted: "750ML" }).status).toBe("pass");
  });
  it("PASS: label states both metric and US-customary; metric matches", () => {
    expect(compareNetContents({ claimed: "750 mL", extracted: "750 mL / 25.4 FL OZ" }).status).toBe("pass");
  });
  it("FAIL: a different metric volume", () => {
    expect(compareNetContents({ claimed: "750 mL", extracted: "375 mL" }).status).toBe("fail");
  });
  it("PASS: same US-customary statement (no metric on either)", () => {
    expect(compareNetContents({ claimed: "12 FL OZ", extracted: "12 fl oz" }).status).toBe("pass");
  });
  it("REVIEW: mixed unit systems can't be compared by magnitude", () => {
    expect(compareNetContents({ claimed: "750 mL", extracted: "25.4 fl oz" }).status).toBe("review");
  });
  it("REVIEW: nothing readable on the label", () => {
    expect(compareNetContents({ claimed: "750 mL", extracted: "" }).status).toBe("review");
  });
});

describe("compareClassType", () => {
  it("PASS: a specific standard of identity matches the application's broad class (same BeverageClass)", () => {
    expect(compareClassType({ claimed: "distilled-spirits", extracted: "Kentucky Straight Bourbon Whiskey" }).status).toBe("pass");
    expect(compareClassType({ claimed: "distilled-spirits", extracted: "Straight Rye Whisky" }).status).toBe("pass");
  });
  it("PASS: identical designation", () => {
    expect(compareClassType({ claimed: "Table Wine", extracted: "Table Wine" }).status).toBe("pass");
  });
  it("PASS: marketing adjectives don't break the verdict (resolves to the same class)", () => {
    // Even if the AI over-captured "Superior Caribbean Rum", the application's "Rum" still matches —
    // both resolve to distilled spirits, so a stray adjective can't cause a wrong Approve/Reject.
    expect(compareClassType({ claimed: "Rum", extracted: "Superior Caribbean Rum" }).status).toBe("pass");
  });
  it("FAIL: genuinely different classes (spirits vs wine)", () => {
    expect(compareClassType({ claimed: "Vodka", extracted: "Cabernet Sauvignon Wine" }).status).toBe("fail");
  });
  it("REVIEW: nothing read from the label", () => {
    expect(compareClassType({ claimed: "distilled-spirits", extracted: "" }).status).toBe("review");
  });
});

describe("compareName (producer/bottler — fuzzy, never a hard fail)", () => {
  it("PASS: identical after normalizing", () => {
    expect(compareName({ claimed: "ABC Distillery", extracted: "ABC DISTILLERY" }).status).toBe("pass");
  });
  it("REVIEW: a company-suffix difference is not a hard fail", () => {
    expect(compareName({ claimed: "ABC Distillery", extracted: "ABC Distilling Co" }).status).toBe("review");
  });
  it("REVIEW: a different producer is review, never fail (importer vs. producer judgement)", () => {
    expect(compareName({ claimed: "ABC Distillery", extracted: "XYZ Imports" }).status).toBe("review");
  });
  it("REVIEW: nothing read from the label", () => {
    expect(compareName({ claimed: "ABC Distillery", extracted: "" }).status).toBe("review");
  });
});

describe("compareAddress (fuzzy, never a hard fail)", () => {
  it("PASS: identical after normalizing", () => {
    expect(compareAddress({ claimed: "Louisville, KY", extracted: "LOUISVILLE KY" }).status).toBe("pass");
  });
  it("REVIEW: a clearly different address is review, never fail", () => {
    expect(compareAddress({ claimed: "Louisville, KY", extracted: "Portland, OR" }).status).toBe("review");
  });
  it("REVIEW: nothing read from the label", () => {
    expect(compareAddress({ claimed: "Louisville, KY", extracted: "" }).status).toBe("review");
  });
});

describe("compareFancifulName + compareStatementOfComposition (fuzzy, never a hard fail)", () => {
  it("PASS: matching fanciful name / statement of composition after normalizing", () => {
    expect(compareFancifulName({ claimed: "Spiced Rum", extracted: "SPICED RUM" }).status).toBe("pass");
    expect(
      compareStatementOfComposition({ claimed: "Rum with natural flavors added", extracted: "Rum with natural flavors added" }).status,
    ).toBe("pass");
  });
  it("REVIEW (never fail): a different statement of composition is a human call", () => {
    expect(
      compareStatementOfComposition({ claimed: "Rum with natural flavors added", extracted: "Vodka with citrus" }).status,
    ).toBe("review");
  });
  it("REVIEW: nothing read from the label", () => {
    expect(compareFancifulName({ claimed: "Spiced Rum", extracted: "" }).status).toBe("review");
  });
});

describe("compareOrigin (country of origin — a real mismatch is a defect)", () => {
  it("PASS: same country, tolerating a 'Product of' prefix", () => {
    expect(compareOrigin({ claimed: "Scotland", extracted: "Product of Scotland" }).status).toBe("pass");
  });
  it("FAIL: a different country", () => {
    expect(compareOrigin({ claimed: "Scotland", extracted: "Ireland" }).status).toBe("fail");
  });
  it("REVIEW: nothing read from the label", () => {
    expect(compareOrigin({ claimed: "Scotland", extracted: "" }).status).toBe("review");
  });
});

describe("comparators are pure (no I/O) and deterministic", () => {
  it("same inputs -> identical outputs across repeated calls", () => {
    const a = compareAlcohol({ claimedText: "45% Alc./Vol.", extractedText: "46% Alc./Vol.", beverageClass: "distilledSpirits" });
    const b = compareAlcohol({ claimedText: "45% Alc./Vol.", extractedText: "46% Alc./Vol.", beverageClass: "distilledSpirits" });
    expect(a).toEqual(b);
  });
});
