/**
 * comparators.test.ts — the three deterministic checks.
 *
 * Expectations are grounded in eval/fixtures/cases.json and the CFR tolerances (independent of
 * the implementation): pass cases, review cases, every failure mode, and one case per beverage
 * class proving the class SELECTS the right tolerance.
 */
import { describe, it, expect } from "vitest";
import { compareBrand, compareAlcohol, compareWarning } from "./comparators";
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
  it("cider resolves to wine ±1.5 (NOT spirits ±0.3): 7.4 passes, 7.6 fails", () => {
    expect(
      compareAlcohol({ claimedText: "6%", extractedText: "7.4%", claimedClass: "Hard Cider" }).status,
    ).toBe("pass");
    expect(
      compareAlcohol({ claimedText: "6%", extractedText: "7.6%", claimedClass: "Hard Cider" }).status,
    ).toBe("fail");
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

describe("comparators are pure (no I/O) and deterministic", () => {
  it("same inputs -> identical outputs across repeated calls", () => {
    const a = compareAlcohol({ claimedText: "45% Alc./Vol.", extractedText: "46% Alc./Vol.", beverageClass: "distilledSpirits" });
    const b = compareAlcohol({ claimedText: "45% Alc./Vol.", extractedText: "46% Alc./Vol.", beverageClass: "distilledSpirits" });
    expect(a).toEqual(b);
  });
});
