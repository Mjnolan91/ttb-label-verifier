/**
 * index.test.ts — Smoke test for the public surface re-exported from ./index, and a
 * type-level check that ClaimedFields / ExtractedFields (incl. the tri-state bold flag)
 * are usable as documented. Cannot run until US-001 adds the toolchain; written in Vitest
 * style for a strict-TS project.
 */

import { describe, it, expect } from "vitest";
import {
  CANONICAL_GOVERNMENT_WARNING,
  GOVERNMENT_WARNING_PREFIX,
  GOVERNMENT_WARNING_PREFIX_FORMAT_NOTE,
  TOLERANCE_TABLE,
  selectToleranceFor,
  proofToAbv,
  abvToProof,
  isWarningRequired,
  WARNING_REQUIRED_ABV_THRESHOLD,
} from "./index";
import type {
  BeverageClass,
  AlcoholContent,
  FieldConfidence,
  ClaimedFields,
  ExtractedFields,
  ToleranceRule,
} from "./index";

describe("domain public surface (barrel re-exports)", () => {
  it("re-exports the warning constants", () => {
    expect(CANONICAL_GOVERNMENT_WARNING.startsWith(GOVERNMENT_WARNING_PREFIX)).toBe(true);
    expect(GOVERNMENT_WARNING_PREFIX_FORMAT_NOTE).toContain("16.22(a)(2)");
  });

  it("re-exports the tolerance table and selector", () => {
    expect(selectToleranceFor("distilledSpirits")).toBe(TOLERANCE_TABLE.distilledSpirits);
  });

  it("re-exports the alcohol helpers and threshold", () => {
    expect(abvToProof(proofToAbv(80))).toBe(80);
    expect(isWarningRequired(WARNING_REQUIRED_ABV_THRESHOLD)).toBe(true);
  });
});

describe("domain types are usable as documented", () => {
  it("ClaimedFields has no confidence; ExtractedFields carries per-field confidence", () => {
    const claimed: ClaimedFields = {
      brand: "Stone's Throw",
      classType: "Kentucky Straight Bourbon",
      beverageClass: "distilledSpirits",
      alcoholContent: { abv: 45, proof: 90 },
      netContents: "750 mL",
      warningText: CANONICAL_GOVERNMENT_WARNING,
    };

    const confidence: FieldConfidence = { brand: 0.99, alcoholContent: 0.97 };
    const abv: AlcoholContent = { abv: 45, proof: 90 };

    const extracted: ExtractedFields = {
      brand: "STONE'S THROW",
      alcoholContent: abv,
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: null, // tri-state: undetectable for this extractor
      confidence,
    };

    expect(claimed.beverageClass).toBe("distilledSpirits");
    expect(extracted.warningPrefixIsBold).toBeNull();
    expect(extracted.warningPrefixIsAllCaps).toBe(true);
  });

  it("BeverageClass union and ToleranceRule line up via the selector", () => {
    const c: BeverageClass = "wineOver14";
    const rule: ToleranceRule = selectToleranceFor(c);
    expect(rule.beverageClass).toBe(c);
    expect(rule.value).toBe(1.0);
  });
});
