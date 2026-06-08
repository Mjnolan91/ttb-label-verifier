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
    nameAndAddress: "Distilled & bottled by Old Tom Distillery, Louisville, KY",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: {
      brand: 0.98,
      classType: 0.97,
      alcoholContent: 0.98,
      netContents: 0.96,
      nameAndAddress: 0.95,
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
    for (const key of ["brand", "classType", "alcoholContent", "netContents", "nameAndAddress", "governmentWarning"]) {
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
});
