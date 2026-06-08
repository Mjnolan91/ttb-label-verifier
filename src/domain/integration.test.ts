/**
 * integration.test.ts — Proves the CFR-verified domain module is WIRED INTO THE
 * PROJECT through its public barrel AND the "@/..." path alias, not merely via relative
 * imports. It EXTENDS (never replaces) the per-file unit tests (warning.test.ts,
 * alcohol.test.ts, tolerances.test.ts, index.test.ts).
 *
 * If `@/domain` ever fails to resolve (tsconfig `paths` or the Vitest alias drift apart),
 * this file fails — catching a broken single-source-of-truth wiring early.
 */
import { describe, it, expect } from "vitest";
// NOTE: imported via the "@/..." alias on purpose — this is the wiring under test.
import {
  CANONICAL_GOVERNMENT_WARNING,
  GOVERNMENT_WARNING_PREFIX,
  abvToProof,
  proofToAbv,
  isWarningRequired,
  selectToleranceFor,
  TOLERANCE_TABLE,
} from "@/domain";
import type { BeverageClass } from "@/domain";

/**
 * Independent, hand-typed copy of the statutory warning (27 CFR 16.21). Kept separate from
 * the constant on purpose so this asserts the constant is VERBATIM rather than tautologically
 * comparing the value to itself. If this fails, fix the constant back to the statute — never
 * edit this expectation. (Mirrors the guarantee in warning.test.ts, but through the barrel.)
 */
const EXPECTED_WARNING_VERBATIM =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

describe("domain wiring through the @/domain barrel", () => {
  it("re-exports the canonical government warning byte-for-byte", () => {
    expect(CANONICAL_GOVERNMENT_WARNING).toBe(EXPECTED_WARNING_VERBATIM);
    expect(CANONICAL_GOVERNMENT_WARNING.startsWith(GOVERNMENT_WARNING_PREFIX)).toBe(true);
  });

  it("exposes the proof = 2 x ABV helper and the 0.5% warning-exemption boundary", () => {
    expect(abvToProof(45)).toBe(90); // "45% Alc./Vol. (90 Proof)"
    expect(proofToAbv(90)).toBe(45);
    expect(proofToAbv(abvToProof(13.5))).toBeCloseTo(13.5, 10);
    expect(isWarningRequired(0.4)).toBe(false); // exempt below 0.5%
    expect(isWarningRequired(0.5)).toBe(true); // required at/above 0.5%
  });

  it("selects each beverage class's documented tolerance value + CFR citation (table-driven)", () => {
    const expected: ReadonlyArray<{
      cls: BeverageClass;
      value: number;
      cfr: string;
    }> = [
      { cls: "distilledSpirits", value: 0.3, cfr: "5.65" },
      { cls: "wineUnder14", value: 1.5, cfr: "4.36" },
      { cls: "wineOver14", value: 1.0, cfr: "4.36" },
      { cls: "maltBeverage", value: 0.3, cfr: "7.65" },
      { cls: "cider", value: 1.5, cfr: "4.36" },
      { cls: "unknown", value: 0.3, cfr: "n/a" },
    ];

    for (const { cls, value, cfr } of expected) {
      const rule = selectToleranceFor(cls);
      expect(rule.beverageClass).toBe(cls);
      expect(rule.value).toBe(value);
      expect(rule.cfrCitation).toContain(cfr);
      // The selector and the table must be the same object (single source of truth).
      expect(rule).toBe(TOLERANCE_TABLE[cls]);
    }
  });
});
