/**
 * warning.ts — The canonical TTB government health warning (verbatim, statutory).
 *
 * CFR-VERIFIED MODULE. The strings in this file are statutory text. They MUST NOT be
 * reworded, reformatted, or "fixed" to make a test pass. If a test disagrees with this
 * text, the test is wrong. See ./README.md.
 *
 * Source of truth (cross-checked, character-for-character):
 *   - 27 CFR 16.21  — mandatory label information / the verbatim warning wording.
 *   - 27 CFR 16.22(a)(2) — formatting rule: the words "GOVERNMENT WARNING" must appear
 *                          in CAPITAL LETTERS and in BOLD TYPE; the remainder of the
 *                          statement may NOT appear in bold type.
 *   - 27 CFR 16.10  — definition of "alcoholic beverage" that fixes the 0.5% ABV
 *                     threshold below which the warning is not required (see alcohol.ts).
 *   - Alcoholic Beverage Labeling Act of 1988 (ABLA), 27 U.S.C. 213-219a, implemented
 *     in 27 CFR Part 16.
 *
 * Research verification result: the warning text below matches AGENTS.md exactly
 * (agentsMdMatchesExactly: true; discrepancies: []). There is therefore NO discrepancy
 * to reconcile — AGENTS.md and the statute are in agreement. Confirmed against the
 * Cornell LII mirror of the eCFR for 27 CFR 16.21.
 */

/**
 * The mandatory prefix that opens the warning. Per 27 CFR 16.22(a)(2) these two words
 * must be rendered in ALL CAPITAL LETTERS and in BOLD TYPE on the physical label, and
 * the colon is part of the statutory phrase as it appears at the head of 16.21's text.
 *
 * The comparator (US-004) uses this to confirm the prefix is present and all-caps, and —
 * where the extractor can detect type weight — that it is bold. Only this prefix is bold;
 * the remainder of the warning must NOT be bold (16.22(a)(2)).
 */
export const GOVERNMENT_WARNING_PREFIX = "GOVERNMENT WARNING:" as const;

/**
 * Human-readable documentation of the formatting rule, kept beside the constant so the
 * "why" travels with the value. This is NOT used for comparison logic; it documents the
 * statutory formatting requirement that the comparator's prefix checks enforce.
 *
 * 27 CFR 16.22(a)(2): the words "GOVERNMENT WARNING" must appear in capital letters and
 * in bold type; the remainder of the warning statement may not appear in bold type.
 */
export const GOVERNMENT_WARNING_PREFIX_FORMAT_NOTE: string =
  'Per 27 CFR 16.22(a)(2), the words "GOVERNMENT WARNING" must appear in CAPITAL ' +
  "LETTERS and in BOLD TYPE. The remainder of the warning statement may not appear in " +
  "bold type.";

/**
 * The canonical government health warning, VERBATIM, as a single normalized line.
 *
 * This is the exact statutory wording from 27 CFR 16.21, identical to the canonical text
 * in AGENTS.md (which presents it as a wrapped markdown blockquote; the line wraps there
 * are display-only and collapse to single spaces). NEVER edit this string to satisfy a
 * test — it is the legal reference every warning comparison is measured against.
 *
 * Notes for the comparator:
 *   - Strict, exact match after whitespace normalization is the intended semantics:
 *     reworded, title-cased ("Government Warning"), or missing text must FAIL.
 *   - The two numbered clauses "(1) ... (2) ..." are part of the required wording.
 */
export const CANONICAL_GOVERNMENT_WARNING: string =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink " +
  "alcoholic beverages during pregnancy because of the risk of birth defects. (2) " +
  "Consumption of alcoholic beverages impairs your ability to drive a car or operate " +
  "machinery, and may cause health problems.";
