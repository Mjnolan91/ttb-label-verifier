/**
 * completeness.test.ts — the TTB completeness check (extraction-first verification).
 */
import { describe, it, expect } from "vitest";
import { checkCompleteness, type ElementStatus } from "./completeness";
import { CANONICAL_GOVERNMENT_WARNING, type ExtractedFields } from "@/domain";

/** A fully-compliant distilled-spirits extraction; override per test. */
function ds(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brand: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    name: "Old Tom Distillery",
    address: "Louisville, KY",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: {
      brand: 0.98,
      classType: 0.97,
      alcoholContent: 0.98,
      netContents: 0.96,
      name: 0.95,
      address: 0.95,
      warningText: 0.96,
    },
    ...overrides,
  };
}

const statusOf = (r: ReturnType<typeof checkCompleteness>, key: string): ElementStatus | undefined =>
  r.elements.find((e) => e.key === key)?.status;

describe("checkCompleteness — internal validity (no application value needed)", () => {
  it("a reworded warning with a correct ALL-CAPS prefix is malformed, not present (27 CFR 16.21)", () => {
    const r = checkCompleteness(ds({ warningText: "GOVERNMENT WARNING: drinking alcohol is bad for you." }));
    expect(statusOf(r, "governmentWarning")).toBe("malformed");
    expect(r.overall).toBe("incomplete");
  });

  it("an internally-inconsistent ABV/proof (proof != 2xABV) is malformed, not present", () => {
    const r = checkCompleteness(ds({ alcoholContentText: "45% Alc./Vol. (80 Proof)" }));
    expect(statusOf(r, "alcoholContent")).toBe("malformed");
    expect(r.overall).toBe("incomplete");
  });

  it("an 'all-caps cannot be verified' (null) prefix is surfaced (present), not hard-failed", () => {
    expect(statusOf(checkCompleteness(ds({ warningPrefixIsAllCaps: null })), "governmentWarning")).toBe("present");
    // a CONFIDENT non-all-caps prefix is still malformed
    expect(statusOf(checkCompleteness(ds({ warningPrefixIsAllCaps: false })), "governmentWarning")).toBe("malformed");
  });
});

describe("checkCompleteness — net contents standards of fill (27 CFR 5.203/4.72/7.70)", () => {
  it("accepts an authorized spirits fill (750 mL) as present", () => {
    expect(statusOf(checkCompleteness(ds({ netContents: "750 mL" })), "netContents")).toBe("present");
  });
  it("flags a non-authorized spirits fill (800 mL) as malformed -> incomplete", () => {
    const r = checkCompleteness(ds({ netContents: "800 mL" }));
    expect(statusOf(r, "netContents")).toBe("malformed");
    expect(r.overall).toBe("incomplete");
  });
  it("flags a spirits/wine net contents stated without metric (US units only)", () => {
    expect(statusOf(checkCompleteness(ds({ netContents: "25.4 FL OZ" })), "netContents")).toBe("malformed");
  });
  it("malt beverages: US-customary is fine (no standard of fill); metric-only is flagged", () => {
    const malt = (nc: string) =>
      checkCompleteness(ds({ classType: "India Pale Ale", alcoholContentText: "5% Alc./Vol.", netContents: nc }));
    expect(statusOf(malt("12 FL OZ"), "netContents")).toBe("present");
    expect(statusOf(malt("19.2 FL OZ"), "netContents")).toBe("present"); // odd size is lawful for malt
    expect(statusOf(malt("355 mL"), "netContents")).toBe("malformed");
  });
});

describe("checkCompleteness", () => {
  it("a fully-compliant distilled-spirits label is complete (absent conditionals don't downgrade)", () => {
    const r = checkCompleteness(ds());
    expect(r.beverageClass).toBe("distilledSpirits");
    expect(r.overall).toBe("complete");
    for (const key of ["brand", "classType", "alcoholContent", "netContents", "name", "address", "governmentWarning"]) {
      expect(statusOf(r, key)).toBe("present");
    }
    // Age statement is conditional and absent -> neutral 'unverifiable', not 'missing'.
    expect(statusOf(r, "ageStatement")).toBe("unverifiable");
  });

  it("flags a missing mandatory element -> incomplete", () => {
    const r = checkCompleteness(ds({ netContents: undefined, confidence: { ...ds().confidence, netContents: undefined } }));
    expect(statusOf(r, "netContents")).toBe("missing");
    expect(r.overall).toBe("incomplete");
  });

  it("flags a malformed government warning (title-case prefix) -> incomplete", () => {
    const r = checkCompleteness(ds({ warningPrefixIsAllCaps: false }));
    expect(statusOf(r, "governmentWarning")).toBe("malformed");
    expect(r.overall).toBe("incomplete");
  });

  it("flags a detectably NON-BOLD warning prefix as malformed (27 CFR 16.22(a)(2)) -> incomplete", () => {
    // Consistent with the comparator (compareWarning fails on bold===false) and the law/Jenny's
    // practice: a confidently not-bold prefix is a real violation, not a mere advisory.
    const r = checkCompleteness(ds({ warningPrefixIsBold: false }));
    expect(statusOf(r, "governmentWarning")).toBe("malformed");
    expect(r.overall).toBe("incomplete");
  });

  it("treats UNDETECTABLE bold (null) as present (no assertion), not a violation", () => {
    const r = checkCompleteness(ds({ warningPrefixIsBold: null }));
    expect(statusOf(r, "governmentWarning")).toBe("present");
    expect(r.overall).toBe("complete");
  });

  it("does not fail a sulfite-free wine: sulfite is conditional (>=10 ppm SO2, 27 CFR 4.32(e))", () => {
    const wine = ds({
      classType: "Cabernet Sauvignon Red Wine", // class derived from this text + ABV
      alcoholContentText: "13.5% Alc./Vol.", // <=14% -> wineUnder14
      // no sulfiteDeclaration: not determinable from the image, so surfaced, never failed
    });
    const r = checkCompleteness(wine);
    expect(r.beverageClass).toBe("wineUnder14");
    expect(statusOf(r, "sulfiteDeclaration")).toBe("unverifiable");
    expect(r.overall).not.toBe("incomplete");
  });

  it("a wine WITH a sulfite declaration is complete", () => {
    const r = checkCompleteness(
      ds({
        classType: "Cabernet Sauvignon Red Wine",
        alcoholContentText: "13.5% Alc./Vol.",
        sulfiteDeclaration: "Contains Sulfites",
        confidence: { ...ds().confidence, sulfiteDeclaration: 0.95 },
      }),
    );
    expect(statusOf(r, "sulfiteDeclaration")).toBe("present");
    expect(r.overall).toBe("complete");
  });

  it("falls back to the broad class when classType is empty (benign mis-split) -> class/type present", () => {
    const r = checkCompleteness(
      ds({
        classType: undefined,
        class: "Whisky",
        confidence: { ...ds().confidence, classType: undefined, class: 0.9 },
      }),
    );
    expect(statusOf(r, "classType")).toBe("present");
    expect(r.beverageClass).toBe("distilledSpirits");
  });

  it("a low-confidence present field -> review (not incomplete)", () => {
    const r = checkCompleteness(ds({ confidence: { ...ds().confidence, brand: 0.4 } }));
    expect(statusOf(r, "brand")).toBe("present");
    expect(r.overall).toBe("review");
  });

  it("a malt beverage may omit alcohol content (optional by default, 27 CFR 7.63(a)(3)) -> not incomplete", () => {
    const r = checkCompleteness(
      ds({
        classType: "India Pale Ale",
        alcoholContentText: undefined,
        netContents: "12 FL OZ", // malt beverages state net contents in US-customary units (27 CFR 7.70)
        confidence: { ...ds().confidence, alcoholContent: undefined },
      }),
    );
    expect(r.beverageClass).toBe("maltBeverage");
    expect(statusOf(r, "alcoholContent")).toBe("unverifiable");
    expect(r.overall).toBe("complete");
  });

  it("a <=14% table wine may omit numeric ABV when a 'table wine' designation is present (27 CFR 4.36(a))", () => {
    const r = checkCompleteness(
      ds({
        classType: "California Table Wine",
        alcoholContentText: undefined,
        sulfiteDeclaration: "Contains Sulfites",
        confidence: { ...ds().confidence, alcoholContent: undefined, sulfiteDeclaration: 0.95 },
      }),
    );
    expect(statusOf(r, "alcoholContent")).toBe("present");
    expect(r.overall).toBe("complete");
  });

  it("a <=14% wine with neither ABV nor a table-wine designation is incomplete", () => {
    const r = checkCompleteness(
      ds({
        classType: "Cabernet Sauvignon Red Wine",
        alcoholContentText: undefined,
        sulfiteDeclaration: "Contains Sulfites",
        confidence: { ...ds().confidence, alcoholContent: undefined, sulfiteDeclaration: 0.95 },
      }),
    );
    expect(statusOf(r, "alcoholContent")).toBe("missing");
    expect(r.overall).toBe("incomplete");
  });

  it("a sub-0.5% ABV product is exempt from the government warning (27 CFR 16.10); absent warning -> not incomplete", () => {
    // Regression for F1: the exemption must read the ABV PARSED from alcoholContentText (there is no
    // pre-parsed struct), so a text-only "0.3% Alc./Vol." still proves sub-0.5% and exempts the warning.
    const r = checkCompleteness(
      ds({
        classType: "Non-Alcoholic Malt Beverage",
        alcoholContentText: "0.3% Alc./Vol.",
        netContents: "12 FL OZ", // malt beverages state net contents in US-customary units (27 CFR 7.70)
        warningText: undefined,
        warningPrefixIsAllCaps: false,
        warningPrefixIsBold: null,
        confidence: { ...ds().confidence, warningText: undefined },
      }),
    );
    expect(statusOf(r, "governmentWarning")).toBe("unverifiable");
    expect(r.overall).not.toBe("incomplete");
  });

  it("keeps the government warning REQUIRED (missing) when ABV is unknown and the warning is absent", () => {
    const r = checkCompleteness(
      ds({
        classType: "Vodka",
        alcoholContentText: undefined,
        warningText: undefined,
        warningPrefixIsAllCaps: false,
        warningPrefixIsBold: null,
        confidence: { ...ds().confidence, alcoholContent: undefined, warningText: undefined },
      }),
    );
    expect(statusOf(r, "governmentWarning")).toBe("missing");
    expect(r.overall).toBe("incomplete");
  });
});
