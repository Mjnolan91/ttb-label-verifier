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

describe("normalizeWarning (wording, case-folded, whitespace-insensitive)", () => {
  it("folds case (prefix caps are judged via the flag, not the text)", () => {
    expect(normalizeWarning("GOVERNMENT WARNING: hi")).toBe(
      normalizeWarning("Government Warning: hi"),
    );
  });
  it("is insensitive to ALL whitespace, including wrapped line breaks", () => {
    expect(normalizeWarning("a\n  b   c")).toBe(normalizeWarning("a b c"));
    expect(normalizeWarning("a\n  b   c")).toBe("abc");
  });
  it("a tight-kerned clause marker is spacing, not a rewording (the Mossy Horn case)", () => {
    // Real approved labels print "(1)According" with no space after the marker; the words are the
    // statutory words, so the wording comparison must treat it as equal to "(1) According".
    expect(normalizeWarning("GOVERNMENT WARNING: (1)According to the Surgeon General")).toBe(
      normalizeWarning("GOVERNMENT WARNING: (1) According to the Surgeon General"),
    );
  });
  it("a genuine rewording still differs (whitespace-stripping cannot mask changed words)", () => {
    expect(normalizeWarning("women should not drink alcoholic beverages")).not.toBe(
      normalizeWarning("women must not drink alcoholic beverages"),
    );
    expect(normalizeWarning("may cause health problems")).not.toBe(
      normalizeWarning("may cause severe health problems"),
    );
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
