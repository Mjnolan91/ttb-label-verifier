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
import { parseAlcoholText } from "./alcohol";
const parseAlcoholTextForTest = (t: string) => parseAlcoholText(t).abv;

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
  it("PASS: a tight-kerned '(1)According' transcription is spacing, not a rewording (Mossy Horn)", () => {
    // A real approved label prints no space after the clause marker; the faithful transcription
    // must not hard-fail the wording check (found 2026-06-11: it did).
    const r = compareWarning({
      ...ok,
      warningText: CANONICAL_GOVERNMENT_WARNING.replace("(1) According", "(1)According"),
    });
    expect(r.status).toBe("pass");
  });
  it("REVIEW: bold undetectable (null) is surfaced for a human, never a silent verified pass", () => {
    // Not a violation (no evidence of one), but not a verification either: the pass message claims a
    // "correctly formatted prefix", so an unverifiable bold flag must route to review instead.
    const r = compareWarning({ ...ok, warningPrefixIsBold: null });
    expect(r.status).toBe("review");
    expect(r.reason).toContain("bold");
    expect(r.reason).toContain("could not be verified");
  });
  it("REVIEW: all-caps undetectable (null) is surfaced for a human too", () => {
    const r = compareWarning({ ...ok, warningPrefixIsAllCaps: null });
    expect(r.status).toBe("review");
    expect(r.reason).toContain("could not be verified");
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
    // The reason states the FULL 16.22(a)(2) prefix requirement, not just the violated half.
    expect(r.reason.toLowerCase()).toContain("bold");
  });
  it("FAIL: prefix detectably not bold", () => {
    expect(compareWarning({ ...ok, warningPrefixIsBold: false }).status).toBe("fail");
  });
  it("FAIL: a caps violation with UNDETECTABLE bold reports both (the bold gap is disclosed, not dropped)", () => {
    // Found live 2026-06-12 on the demo defect sample: caps=false, bold=null produced a reason
    // that never mentioned bold, so the applicant was told about one of two prefix problems.
    const r = compareWarning({ ...ok, warningPrefixIsAllCaps: false, warningPrefixIsBold: null });
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("ALL CAPITAL LETTERS and BOLD type");
    expect(r.reason).toContain("is not in all capital letters");
    expect(r.reason).toContain("Bold type could not be verified");
  });
  it("FAIL: caps and bold BOTH detectably wrong list both defects in one reason", () => {
    const r = compareWarning({ ...ok, warningPrefixIsAllCaps: false, warningPrefixIsBold: false });
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("is not in all capital letters and is not in bold type");
  });
  it("FAIL: a bold violation with UNDETECTABLE caps discloses the unverified caps", () => {
    const r = compareWarning({ ...ok, warningPrefixIsAllCaps: null, warningPrefixIsBold: false });
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("is not in bold type");
    expect(r.reason).toContain("All capital letters could not be verified");
  });
  it("FAIL: the statement REMAINDER detectably bold — 16.22(a)(2) forbids a bold body", () => {
    // An extra-bold prefix over a bold body satisfies "prefix bolder than body" yet still violates
    // the second sentence of 16.22(a)(2): the remainder may not appear in bold type.
    const r = compareWarning({ ...ok, warningRemainderIsBold: true });
    expect(r.status).toBe("fail");
    expect(r.reason).toContain("remainder");
  });
  it("REVIEW: warning judged hard to read — legibility (16.22(a)(1)) routes to a human, never auto-fails", () => {
    const r = compareWarning({ ...ok, warningIsReadilyLegible: false });
    expect(r.status).toBe("review");
    expect(r.reason).toContain("legible");
  });
  it("PASS: the supplementary signals stay SILENT on null/undefined (asymmetric to the prefix flags)", () => {
    // Italic style alone is not a violation, and an unreadable supplementary signal must not flood
    // review: only the prefix format demands positive verification.
    expect(compareWarning({ ...ok, warningRemainderIsBold: null, warningIsReadilyLegible: null }).status).toBe("pass");
    expect(compareWarning(ok).status).toBe("pass"); // undefined (older fixtures) behaves the same
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

describe("compareOrigin — match is not compliance: the statement must name a country", () => {
  it("a region matching the application verbatim still routes to review, naming the likely country", () => {
    const r = compareOrigin({
      claimed: "Imported from the Caribbean",
      extracted: "Imported from the Caribbean",
      extractedAddress: "Bridgetown, Barbados.",
    });
    expect(r.status).toBe("review");
    expect(r.reason).toMatch(/does not name a recognized country/);
    expect(r.reason).toMatch(/Product of Barbados/);
    expect(r.reason).not.toMatch(/[–—]/); // copy standard
  });

  it("a region with no address hint reviews with the generic CBP reason", () => {
    const r = compareOrigin({ claimed: "Product of Europe", extracted: "Product of Europe" });
    expect(r.status).toBe("review");
    expect(r.reason).toMatch(/CBP/);
  });

  it("a real country marking still passes, including US forms", () => {
    expect(compareOrigin({ claimed: "Product of Barbados", extracted: "Product of Barbados" }).status).toBe("pass");
    expect(compareOrigin({ claimed: "Made in the USA", extracted: "Made in the USA" }).status).toBe("pass");
  });
});

describe("common human errors — not getting it wrong (probe regressions, 2026-06-10)", () => {
  it('".75L" reads as 0.75 L, never a 100x misparse that hard-fails', () => {
    const r = compareNetContents({ claimed: ".75L", extracted: "750 mL" });
    expect(r.status).toBe("pass");
  });

  it('"75 cl" is 750 mL (standard on European labels and applications)', () => {
    expect(compareNetContents({ claimed: "75 cl", extracted: "750 mL" }).status).toBe("pass");
  });

  it('a proof-only claim ("80 proof") compares as its ABV, with the derivation named', () => {
    const r = compareAlcohol({ claimedText: "80 proof", extractedText: "40% ALC/VOL (80 PROOF)" });
    expect(r.status).toBe("pass");
    expect(r.reason).toMatch(/derived from the stated proof/);
  });

  it("a proof-only LABEL read never derives (a %-less label is itself a 5.65 defect): review", () => {
    // Deriving on the label side would let a proof-only label pass comparison while completeness
    // read the statement as present — a false-approve corridor (adversarial audit FP-2).
    const r = compareAlcohol({ claimedText: "40% Alc./Vol.", extractedText: "80 PROOF" });
    expect(r.status).toBe("review");
  });

  it('a typed-but-unparseable claim names the problem instead of saying nothing was claimed', () => {
    const r = compareAlcohol({ claimedText: "40", extractedText: "40% ALC/VOL (80 PROOF)" });
    expect(r.status).toBe("review");
    expect(r.reason).toMatch(/Couldn't parse the application's alcohol entry/);
  });

  it("a genuinely wrong proof-only claim still fails (derivation is not leniency)", () => {
    const r = compareAlcohol({ claimedText: "90 proof", extractedText: "40% ALC/VOL (80 PROOF)" });
    expect(r.status).toBe("fail");
  });
});

describe("compareClassType — same family is not the same designation (adversarial audit)", () => {
  it("Vodka vs Gin: shared family must NOT pass; review with the family named", () => {
    const r = compareClassType({ claimed: "Vodka", extracted: "Gin" });
    expect(r.status).toBe("review");
    expect(r.reason).toMatch(/designations differ/);
  });

  it("Stout vs Lager: same malt family, different designations, review", () => {
    expect(compareClassType({ claimed: "Stout", extracted: "Lager" }).status).toBe("review");
  });

  it("whisky/whiskey spelling variants are one designation", () => {
    expect(compareClassType({ claimed: "Straight Bourbon Whisky", extracted: "Straight Bourbon Whiskey" }).status).toBe("pass");
    expect(compareClassType({ claimed: "Whisky", extracted: "Kentucky Straight Bourbon Whiskey" }).status).toBe("pass");
  });
});

describe("net contents and warning — adversarial audit regressions", () => {
  it("equal US-customary quantities in different units match: 1 PINT = 16 FL OZ", () => {
    expect(compareNetContents({ claimed: "1 PINT", extracted: "16 FL OZ" }).status).toBe("pass");
  });

  it('bare "12 oz" parses as fluid ounces (the beer shorthand)', () => {
    expect(compareNetContents({ claimed: "12 oz", extracted: "12 FL OZ" }).status).toBe("pass");
  });

  it('combination statements sum: "1 PT 8 FL OZ" = 24 FL OZ', () => {
    expect(compareNetContents({ claimed: "1 PT 8 FL OZ", extracted: "24 FL OZ" }).status).toBe("pass");
  });

  it("a hyphenated line-break in the warning transcription is not a rewording", () => {
    const hyphenated = CANONICAL_GOVERNMENT_WARNING.replace("machinery", "machin- ery").replace("pregnancy", "preg- nancy");
    const r = compareWarning({ warningText: hyphenated, warningPrefixIsAllCaps: true, warningPrefixIsBold: true });
    expect(r.status).toBe("pass");
  });

  it("an actual rewording still fails after hyphen healing", () => {
    const reworded = CANONICAL_GOVERNMENT_WARNING.replace("machinery", "heavy equipment");
    const r = compareWarning({ warningText: reworded, warningPrefixIsAllCaps: true, warningPrefixIsBold: true });
    expect(r.status).toBe("fail");
  });

  it('"LESS THAN 0.5% ALC/VOL" is a bound: the warning exemption applies', () => {
    const r = compareWarning({ warningText: "", warningPrefixIsAllCaps: false, warningPrefixIsBold: null, abv: parseAlcoholTextForTest("LESS THAN 0.5% ALC/VOL") });
    expect(r.status).toBe("pass");
  });

  it('"NOT less than 40% ALC/VOL" keeps the floor value (no false exemption direction)', () => {
    expect(parseAlcoholTextForTest("Bottled at not less than 40% ALC/VOL")).toBe(40);
  });
});
