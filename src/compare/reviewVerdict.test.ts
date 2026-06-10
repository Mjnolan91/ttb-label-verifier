// src/compare/reviewVerdict.test.ts
/**
 * reviewVerdict.test.ts — the verdict that gates approval on per-type completeness.
 */
import { describe, it, expect } from "vitest";
import { combinedVerdict, worstVerdict, toClaimedFields } from "./reviewVerdict";
import { CANONICAL_GOVERNMENT_WARNING, type ClaimedFields, type ExtractedFields } from "@/domain";

describe("toClaimedFields — the batch 'enough to compare?' gate (brand always; alcohol per type)", () => {
  const spiritsRead: ExtractedFields = {
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: {},
  };
  const maltRead: ExtractedFields = {
    classType: "India Pale Ale",
    alcoholContentText: "6.5% Alc./Vol.",
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: {},
  };

  it("brand is required for every class", () => {
    const noBrand = toClaimedFields({ alcoholContentText: "40% Alc./Vol." }, spiritsRead);
    expect(noBrand.claimed).toBeNull();
    expect(noBrand.missing).toContain("brand");
    const blankBrand = toClaimedFields({ brand: "   ", alcoholContentText: "40% Alc./Vol." }, spiritsRead);
    expect(blankBrand.claimed).toBeNull();
  });

  it("alcohol is required for distilled spirits (27 CFR 5.65): a spirits row without it gets no verdict", () => {
    const gate = toClaimedFields({ brand: "Acme", netContents: "750 mL" }, spiritsRead);
    expect(gate.claimed).toBeNull();
    expect(gate.missing).toEqual(["alcoholContent"]);
    expect(gate.beverageClass).toBe("distilledSpirits");
  });

  it("alcohol is OPTIONAL for a malt beverage (27 CFR 7.63(a)(3)): the row verifies without it", () => {
    const gate = toClaimedFields(
      { brand: "Granite Peak", classType: "India Pale Ale", netContents: "12 FL OZ" },
      maltRead,
    );
    expect(gate.missing).toEqual([]);
    expect(gate.claimed).toEqual({
      brand: "Granite Peak",
      alcoholContentText: undefined,
      classType: "India Pale Ale",
      netContents: "12 FL OZ",
      name: undefined,
      address: undefined,
      countryOfOrigin: undefined,
      fancifulName: undefined,
      statementOfComposition: undefined,
    });
    expect(gate.beverageClass).toBe("maltBeverage");
  });

  it("resolves the class from the CLAIMED class/type first, else the label's reading", () => {
    // The claimed row says Table Wine; the label ABV (12.5%) puts it under 14% — alcohol optional.
    const wineRead: ExtractedFields = {
      classType: "Table Wine",
      alcoholContentText: "12.5% Alc./Vol.",
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: true,
      confidence: {},
    };
    const gate = toClaimedFields({ brand: "Marisol", classType: "Table Wine" }, wineRead);
    expect(gate.beverageClass).toBe("wineUnder14");
    expect(gate.missing).toEqual([]);
    expect(gate.claimed).not.toBeNull();
  });

  it("an unknown class stays conservative: alcohol required", () => {
    const blankRead: ExtractedFields = { warningPrefixIsAllCaps: false, warningPrefixIsBold: null, confidence: {} };
    const gate = toClaimedFields({ brand: "Acme" }, blankRead);
    expect(gate.claimed).toBeNull();
    expect(gate.missing).toEqual(["alcoholContent"]);
  });

  it("builds ClaimedFields from loose inputs, trimming and dropping empty optional fields", () => {
    const gate = toClaimedFields(
      { brand: " Acme ", alcoholContentText: " 40% Alc./Vol. ", classType: " Vodka ", netContents: " 750 mL ", name: " Acme Distillery ", address: " Peoria, IL ", countryOfOrigin: " USA " },
      spiritsRead,
    );
    expect(gate.claimed).toEqual({
      brand: "Acme", alcoholContentText: "40% Alc./Vol.", classType: "Vodka",
      netContents: "750 mL", name: "Acme Distillery", address: "Peoria, IL", countryOfOrigin: "USA",
      fancifulName: undefined, statementOfComposition: undefined,
    });
  });
});

const CLAIMED: ClaimedFields = {
  brand: "Old Tom Distillery",
  classType: "distilled-spirits",
  alcoholContentText: "45% Alc./Vol. (90 Proof)",
};

/** A distilled-spirits label that carries EVERY mandatory element (brand, class/type, alcohol, net
 *  contents, producer name + address, government warning). */
function completeSpirits(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brand: "Old Tom Distillery",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    name: "Old Tom Distillery",
    address: "Louisville, KY",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: {
      brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96,
      name: 0.95, address: 0.95, warningText: 0.96,
    },
    ...overrides,
  };
}

describe("worstVerdict", () => {
  it("returns the more conservative of two verdicts (both argument orders)", () => {
    expect(worstVerdict("approve", "review")).toBe("review");
    expect(worstVerdict("review", "approve")).toBe("review");
    expect(worstVerdict("reject", "review")).toBe("reject");
    expect(worstVerdict("review", "reject")).toBe("reject");
    expect(worstVerdict("approve", "approve")).toBe("approve");
  });
});

describe("combinedVerdict", () => {
  it("APPROVE: every mandatory element present and the 3 checks pass", () => {
    const r = combinedVerdict(CLAIMED, completeSpirits());
    expect(r.overall).toBe("approve");
    expect(r.gatedByCompleteness).toBe(false);
    expect(r.verify?.overall).toBe("approve");
  });

  it("GATES approve -> review when the 3 checks pass but a MANDATORY field is missing", () => {
    // Drop net contents (mandatory for spirits). Brand/alcohol/warning still pass.
    const r = combinedVerdict(CLAIMED, completeSpirits({ netContents: undefined, confidence: {
      brand: 0.98, classType: 0.97, alcoholContent: 0.98, name: 0.95, address: 0.95, warningText: 0.96,
    } }));
    expect(r.verify?.overall).toBe("approve"); // the 3 checks alone would approve
    expect(r.overall).toBe("review");          // but completeness blocks it
    expect(r.gatedByCompleteness).toBe(true);
  });

  it("GATES approve -> review when a mandatory field is present but read with LOW confidence", () => {
    // net contents is present but below FIELD_REVIEW_CONFIDENCE (0.7) -> completeness "review" ->
    // the combined verdict is gated even though no field is missing and the 3 checks pass.
    const r = combinedVerdict(CLAIMED, completeSpirits({
      confidence: {
        brand: 0.98, classType: 0.97, alcoholContent: 0.98,
        netContents: 0.6, name: 0.95, address: 0.95, warningText: 0.96,
      },
    }));
    expect(r.verify?.overall).toBe("approve");
    expect(r.completeness.overall).toBe("review");
    expect(r.overall).toBe("review");
    expect(r.gatedByCompleteness).toBe(true);
  });

  it("REJECT dominates: an out-of-tolerance ABV rejects regardless of completeness", () => {
    const r = combinedVerdict(
      { ...CLAIMED, alcoholContentText: "45% Alc./Vol." },
      completeSpirits({ alcoholContentText: "46% Alc./Vol.", netContents: undefined }),
    );
    expect(r.overall).toBe("reject");
    expect(r.gatedByCompleteness).toBe(false); // verify already reject; completeness didn't worsen it
  });

  it("no application values -> overall null (completeness is the headline)", () => {
    const r = combinedVerdict(null, completeSpirits());
    expect(r.overall).toBeNull();
    expect(r.verify).toBeNull();
    expect(r.completeness.overall).toBe("complete");
  });
});
