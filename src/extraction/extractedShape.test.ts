/**
 * extractedShape.test.ts — the raw->domain mapping boundary (catalog-driven).
 */
import { describe, it, expect } from "vitest";
import { mapRawExtracted, type RawExtractedFields } from "./extractedShape";
import { FIELD_CATALOG } from "./fieldCatalog";

const raw: RawExtractedFields = {
  brand: { value: "Old Tom", confidence: 0.95 },
  classType: { value: "Kentucky Straight Bourbon Whiskey", confidence: 0.9 },
  alcoholContent: { value: "45% Alc./Vol. (90 Proof)", confidence: 0.97 },
  name: { value: "ABC Distillery", confidence: 0.8 },
  address: { value: "Frederick, MD", confidence: 0.8 },
  sulfiteDeclaration: { value: "Contains Sulfites", confidence: 0.7 },
  warningPrefixIsAllCaps: true,
  warningPrefixIsBold: null,
};

describe("mapRawExtracted", () => {
  it("maps the alcohol rawKey to alcoholContentText + the alcoholContent confidence channel", () => {
    const e = mapRawExtracted(raw);
    expect(e.alcoholContentText).toBe("45% Alc./Vol. (90 Proof)");
    expect(e.confidence.alcoholContent).toBe(0.97);
  });

  it("maps each present catalog field to its value key and confidence key", () => {
    const e = mapRawExtracted(raw);
    expect(e.brand).toBe("Old Tom");
    expect(e.confidence.brand).toBe(0.95);
    expect(e.name).toBe("ABC Distillery");
    expect(e.address).toBe("Frederick, MD");
    expect(e.sulfiteDeclaration).toBe("Contains Sulfites");
  });

  it("carries the warning format flags verbatim and omits absent fields", () => {
    const e = mapRawExtracted(raw);
    expect(e.warningPrefixIsAllCaps).toBe(true);
    expect(e.warningPrefixIsBold).toBeNull();
    // A rawKey not provided yields no value and no confidence entry.
    expect(e.countryOfOrigin).toBeUndefined();
    expect(e.confidence.countryOfOrigin).toBeUndefined();
  });

  it("never sets a confidence channel for a field that wasn't read", () => {
    const e = mapRawExtracted(raw);
    for (const d of FIELD_CATALOG) {
      const provided = (raw as unknown as Record<string, unknown>)[d.rawKey] !== undefined;
      if (!provided) expect(e.confidence[d.confKey]).toBeUndefined();
    }
  });
});
