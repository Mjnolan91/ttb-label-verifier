/**
 * appInputs.test.ts — the shared application-input descriptor (one source for both screens).
 */
import { describe, expect, it } from "vitest";
import {
  APP_INPUT_ORDER,
  APP_INPUT_SPECS,
  appInputConfidence,
  appInputSuggestion,
  countryOfOriginImportNote,
} from "./appInputs";
import { APP_FIELD_HELP } from "./fieldHelpCopy";
import type { ExtractedFields } from "@/domain";

describe("APP_INPUT_ORDER / APP_INPUT_SPECS", () => {
  it("covers EVERY application input exactly once (a new AppInputKey must be ordered here)", () => {
    expect([...APP_INPUT_ORDER].sort()).toEqual(Object.keys(APP_FIELD_HELP).sort());
    expect(new Set(APP_INPUT_ORDER).size).toBe(APP_INPUT_ORDER.length);
    expect(APP_INPUT_SPECS.map((s) => s.key)).toEqual([...APP_INPUT_ORDER]);
  });
});

describe("appInputSuggestion / appInputConfidence", () => {
  const extracted: ExtractedFields = {
    brand: "Acme",
    class: "Distilled Spirits",
    alcoholContentText: "40% Alc./Vol.",
    address: "Baltimore, MD",
    countryOfOrigin: "USA",
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: { brand: 0.95, class: 0.7, alcoholContent: 0.9, address: 0.9, countryOfOrigin: 0.6 },
  };

  it("class/type falls back to the broad class (value AND confidence together)", () => {
    expect(appInputSuggestion(extracted, "classType")).toBe("Distilled Spirits");
    expect(appInputConfidence(extracted, "classType")).toBe(0.7);
    const specific = {
      ...extracted,
      classType: "Vodka",
      confidence: { ...extracted.confidence, classType: 0.92 },
    };
    expect(appInputSuggestion(specific, "classType")).toBe("Vodka");
    expect(appInputConfidence(specific, "classType")).toBe(0.92);
  });

  it("alcohol is suggested from the as-written text", () => {
    expect(appInputSuggestion(extracted, "alcoholContent")).toBe("40% Alc./Vol.");
    expect(appInputConfidence(extracted, "alcoholContent")).toBe(0.9);
  });

  it("country of origin is SUPPRESSED for an inferred-domestic product (imports-only input)", () => {
    expect(appInputSuggestion(extracted, "countryOfOrigin")).toBeUndefined();
    const imported = { ...extracted, countryOfOrigin: "Product of Barbados" };
    expect(appInputSuggestion(imported, "countryOfOrigin")).toBe("Product of Barbados");
  });
});

describe("countryOfOriginImportNote", () => {
  const base: ExtractedFields = {
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: {},
  };

  it("announces an inferred import with no printed statement, naming the evidence", () => {
    // The Sailor Sally's case: a blank imports-only input read as "the AI missed Spain" even
    // though the system had classified the label as an import and flagged the verdict.
    const note = countryOfOriginImportNote({
      ...base,
      address: "Valencia, Spain",
      importerStatement: "IMPORTED BY: SEA TRADER IMPORTS, MIAMI, FL.",
    });
    expect(note).toMatch(/Import detected/);
    expect(note).toMatch(/importer statement/);
    expect(note).toMatch(/Valencia, Spain/);
    expect(note).toMatch(/Product of/);
  });

  it("stays silent for a domestic or unknown-origin label", () => {
    expect(countryOfOriginImportNote({ ...base, address: "Baltimore, MD" })).toBeUndefined();
    expect(countryOfOriginImportNote(base)).toBeUndefined();
  });

  it("stays silent when a printed origin statement WAS read (the suggestion covers it)", () => {
    expect(
      countryOfOriginImportNote({ ...base, countryOfOrigin: "Product of Spain", address: "Valencia, Spain" }),
    ).toBeUndefined();
  });
});
