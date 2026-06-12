/**
 * extractedShape.test.ts — the raw->domain mapping boundary (catalog-driven), and
 * dedupeRepeatedRead: a joint front+back read sometimes transcribes a fact printed on both
 * panels into one field twice ("750 mL 750 ML"); the mapper collapses exactly that shape and
 * nothing else, with the government warning exempt (its statutory comparison must always see
 * the honest transcription).
 */
import { describe, it, expect } from "vitest";
import { dedupeRepeatedRead, mapRawExtracted, type RawExtractedFields } from "./extractedShape";
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

  it("maps EVERY catalog field — full coverage of the single source of truth", () => {
    const full: Record<string, unknown> = { warningPrefixIsAllCaps: true, warningPrefixIsBold: null };
    for (const d of FIELD_CATALOG) full[d.rawKey] = { value: `v-${d.key}`, confidence: 0.9 };
    const e = mapRawExtracted(full as unknown as RawExtractedFields);
    const eByKey = e as unknown as Record<string, unknown>;
    for (const d of FIELD_CATALOG) {
      expect(eByKey[d.key]).toBe(`v-${d.key}`);
      expect(e.confidence[d.confKey]).toBe(0.9);
    }
  });

  it("never sets a confidence channel for a field that wasn't read", () => {
    const e = mapRawExtracted(raw);
    for (const d of FIELD_CATALOG) {
      const provided = (raw as unknown as Record<string, unknown>)[d.rawKey] !== undefined;
      if (!provided) expect(e.confidence[d.confKey]).toBeUndefined();
    }
  });

  it("dedupes a twice-read value on ordinary fields (found live 2026-06-12: '750 ML 750ml')", () => {
    const e = mapRawExtracted({
      ...raw,
      netContents: { value: "750 ML 750ml", confidence: 0.92 },
      alcoholContent: { value: "33% ALC/VOL 33% alc/vol", confidence: 0.9 },
    });
    expect(e.netContents).toBe("750 ML");
    expect(e.alcoholContentText).toBe("33% ALC/VOL");
    expect(e.confidence.netContents).toBe(0.92);
  });

  it("NEVER touches the government warning, even a duplicated transcription", () => {
    const doubled = "GOVERNMENT WARNING: drink responsibly GOVERNMENT WARNING: drink responsibly";
    const e = mapRawExtracted({ ...raw, warningText: { value: doubled, confidence: 0.9 } });
    expect(e.warningText).toBe(doubled);
  });
});

describe("dedupeRepeatedRead", () => {
  it("collapses the same digit-bearing reading printed twice, keeping the first reading's casing", () => {
    expect(dedupeRepeatedRead("750 ML 750ml")).toBe("750 ML");
    expect(dedupeRepeatedRead("750 mL / 750 ML")).toBe("750 mL");
    expect(dedupeRepeatedRead("ALC. 33% BY VOL. (66 PROOF) ALC 33% BY VOL 66 PROOF")).toBe(
      "ALC. 33% BY VOL. (66 PROOF)",
    );
    expect(dedupeRepeatedRead("123 Main St, Louisville, KY / 123 Main St Louisville KY")).toBe(
      "123 Main St, Louisville, KY",
    );
    // A parenthesized second reading must not leave a dangling "(" behind.
    expect(dedupeRepeatedRead("750 mL (750 ML)")).toBe("750 mL");
  });

  it("never touches a value without digits: name-like values legitimately double", () => {
    expect(dedupeRepeatedRead("Walla Walla")).toBe("Walla Walla");
    expect(dedupeRepeatedRead("New York, New York")).toBe("New York, New York");
    expect(dedupeRepeatedRead("Fireball Fireball")).toBe("Fireball Fireball");
  });

  it("never splits a single continuous token, even when its halves match", () => {
    expect(dedupeRepeatedRead("5050")).toBe("5050"); // a lot number is not a repeat
    expect(dedupeRepeatedRead("55")).toBe("55");
    expect(dedupeRepeatedRead("A1A1")).toBe("A1A1");
  });

  it("leaves tiny doubled tokens alone (a '50/50' brand is a value, not a double read)", () => {
    expect(dedupeRepeatedRead("50/50")).toBe("50/50");
    expect(dedupeRepeatedRead("5 5")).toBe("5 5");
  });

  it("leaves genuinely different values and partial overlaps untouched", () => {
    expect(dedupeRepeatedRead("45% Alc./Vol. (90 Proof)")).toBe("45% Alc./Vol. (90 Proof)");
    expect(dedupeRepeatedRead("750 ML 700 ML")).toBe("750 ML 700 ML");
    expect(dedupeRepeatedRead("")).toBe("");
    expect(dedupeRepeatedRead("750 ML")).toBe("750 ML");
  });

  it("leaves three repeats alone (halves cannot match; conservative by design)", () => {
    expect(dedupeRepeatedRead("750 ML 750 ML 750 ML")).toBe("750 ML 750 ML 750 ML");
  });
});
