/**
 * warning.test.ts — Asserts the canonical government warning is VERBATIM.
 *
 * The expected string below is an INDEPENDENT, hand-typed copy of the statutory text from
 * 27 CFR 16.21 / AGENTS.md. The point of this test is to catch any accidental reword of the
 * constant — so it deliberately does NOT derive the expectation from the constant itself.
 * If this test fails, FIX THE CONSTANT back to the statute; never edit this expectation to
 * make it pass (that would defeat the check). See ./README.md.
 */

import { describe, it, expect } from "vitest";
import {
  CANONICAL_GOVERNMENT_WARNING,
  GOVERNMENT_WARNING_PREFIX,
  GOVERNMENT_WARNING_PREFIX_FORMAT_NOTE,
} from "./warning";

// Independent, character-for-character copy of the statutory warning (single normalized line).
const EXPECTED_VERBATIM_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";

describe("CANONICAL_GOVERNMENT_WARNING", () => {
  it("matches the statutory 27 CFR 16.21 text verbatim", () => {
    expect(CANONICAL_GOVERNMENT_WARNING).toBe(EXPECTED_VERBATIM_WARNING);
  });

  it("starts with the mandatory all-caps prefix", () => {
    expect(CANONICAL_GOVERNMENT_WARNING.startsWith(GOVERNMENT_WARNING_PREFIX)).toBe(true);
  });

  it("contains both numbered statutory clauses", () => {
    expect(CANONICAL_GOVERNMENT_WARNING).toContain("(1) According to the Surgeon General");
    expect(CANONICAL_GOVERNMENT_WARNING).toContain(
      "(2) Consumption of alcoholic beverages",
    );
  });

  it("has no leading/trailing whitespace and no collapsed internal double-spaces", () => {
    expect(CANONICAL_GOVERNMENT_WARNING).toBe(CANONICAL_GOVERNMENT_WARNING.trim());
    expect(CANONICAL_GOVERNMENT_WARNING).not.toContain("  ");
  });
});

describe("GOVERNMENT_WARNING_PREFIX", () => {
  it('is exactly "GOVERNMENT WARNING:"', () => {
    expect(GOVERNMENT_WARNING_PREFIX).toBe("GOVERNMENT WARNING:");
  });

  it("is all upper-case (ignoring the colon), per 27 CFR 16.22(a)(2)", () => {
    const letters = GOVERNMENT_WARNING_PREFIX.replace(/[^A-Za-z]/g, "");
    expect(letters).toBe(letters.toUpperCase());
  });

  it("documents the capitals + bold formatting rule with its CFR citation", () => {
    expect(GOVERNMENT_WARNING_PREFIX_FORMAT_NOTE).toContain("16.22(a)(2)");
    expect(GOVERNMENT_WARNING_PREFIX_FORMAT_NOTE.toLowerCase()).toContain("bold");
    expect(GOVERNMENT_WARNING_PREFIX_FORMAT_NOTE.toLowerCase()).toContain("capital");
  });
});
