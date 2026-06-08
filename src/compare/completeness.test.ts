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
    beverageClass: "distilledSpirits",
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

  it("requires a sulfite declaration for wine; missing -> incomplete", () => {
    const wine = ds({
      classType: "Cabernet Sauvignon Red Wine",
      beverageClass: undefined, // force derivation from classType text
    });
    const r = checkCompleteness(wine);
    expect(r.beverageClass).toBe("wineUnder14");
    expect(statusOf(r, "sulfiteDeclaration")).toBe("missing");
    expect(r.overall).toBe("incomplete");
  });

  it("a wine WITH a sulfite declaration is complete", () => {
    const r = checkCompleteness(
      ds({
        classType: "Cabernet Sauvignon",
        beverageClass: "wineUnder14",
        sulfiteDeclaration: "Contains Sulfites",
        confidence: { ...ds().confidence, sulfiteDeclaration: 0.95 },
      }),
    );
    expect(statusOf(r, "sulfiteDeclaration")).toBe("present");
    expect(r.overall).toBe("complete");
  });

  it("a low-confidence present field -> review (not incomplete)", () => {
    const r = checkCompleteness(ds({ confidence: { ...ds().confidence, brand: 0.4 } }));
    expect(statusOf(r, "brand")).toBe("present");
    expect(r.overall).toBe("review");
  });

  it("a malt beverage may omit alcohol content (optional by default, 27 CFR 7.63(a)(3)) -> not incomplete", () => {
    const r = checkCompleteness(
      ds({
        beverageClass: "maltBeverage",
        classType: "India Pale Ale",
        alcoholContentText: undefined,
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
        beverageClass: "wineUnder14",
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
        beverageClass: "wineUnder14",
        classType: "Cabernet Sauvignon",
        alcoholContentText: undefined,
        sulfiteDeclaration: "Contains Sulfites",
        confidence: { ...ds().confidence, alcoholContent: undefined, sulfiteDeclaration: 0.95 },
      }),
    );
    expect(statusOf(r, "alcoholContent")).toBe("missing");
    expect(r.overall).toBe("incomplete");
  });

  it("a sub-0.5% ABV product is exempt from the government warning (27 CFR 16.10); absent warning -> not incomplete", () => {
    const r = checkCompleteness(
      ds({
        beverageClass: "maltBeverage",
        classType: "Non-Alcoholic Malt Beverage",
        alcoholContentText: "0.3% Alc./Vol.",
        alcoholContent: { abv: 0.3 },
        warningText: undefined,
        warningPrefixIsAllCaps: false,
        warningPrefixIsBold: null,
        confidence: { ...ds().confidence, warningText: undefined },
      }),
    );
    expect(statusOf(r, "governmentWarning")).toBe("unverifiable");
    expect(r.overall).not.toBe("incomplete");
  });
});
