/**
 * text.test.ts — normalization + similarity helpers.
 */
import { describe, it, expect } from "vitest";
import { normalizeText, normalizeWarning, levenshtein, similarity } from "./text";

describe("normalizeText (brand normalization)", () => {
  it("makes the smart-quote brand pair identical (case + curly apostrophe)", () => {
    // "STONE’S THROW" vs "Stone’s Throw" — both use U+2019.
    expect(normalizeText("STONE’S THROW")).toBe(normalizeText("Stone’s Throw"));
  });

  it("treats a straight and curly apostrophe the same", () => {
    expect(normalizeText("Stone's Throw")).toBe(normalizeText("Stone’s Throw"));
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeText("  Old   Tom\tDistillery  ")).toBe("old tom distillery");
  });

  it("drops punctuation differences", () => {
    expect(normalizeText("St. George")).toBe(normalizeText("St George"));
  });
});

describe("normalizeWarning (wording, case-folded)", () => {
  it("folds case (prefix caps are judged via the flag, not the text)", () => {
    expect(normalizeWarning("GOVERNMENT WARNING: hi")).toBe(
      normalizeWarning("Government Warning: hi"),
    );
  });
  it("collapses wrapped whitespace", () => {
    expect(normalizeWarning("a\n  b   c")).toBe("a b c");
  });
});

describe("levenshtein + similarity", () => {
  it("distance is 0 for identical, 1 for a single insertion", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("old tom distillery", "old tomm distillery")).toBe(1);
  });

  it("a one-character typo in a brand is highly similar (lands in review band)", () => {
    const sim = similarity("old tom distillery", "old tomm distillery");
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThan(1);
  });

  it("identical strings are similarity 1; very different are low", () => {
    expect(similarity("acme", "acme")).toBe(1);
    expect(similarity("acme distillery", "zzz")).toBeLessThan(0.3);
  });
});
