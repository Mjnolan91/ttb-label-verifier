/**
 * compare/text.ts — pure text-normalization + similarity helpers used by the comparators.
 */

/**
 * Normalize a brand-like string for TOLERANT comparison:
 *   diacritics folded, smart quotes -> straight, lowercased, punctuation -> space, the English
 *   connector word "and" (and its "&" form) dropped, whitespace collapsed, trimmed.
 * So "STONE’S THROW" and "Stone’s Throw" both become "stone s throw" (a pass), "José" matches
 * "Jose", and "Smith & Sons" matches "SMITH AND SONS" — while a real character difference (an
 * inserted letter) survives as a difference (routed to review). Dropping "and"/"&" outright (vs
 * expanding one into the other) keeps the deliberate symbols policy intact: "Smith & Co" vs
 * "Smith Co" still normalize EQUAL here and then route to review via the symbols-kept check.
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // fold combining diacritics: "José" -> "Jose"
    .replace(/[‘’‛′]/g, "'") // curly/single quotes -> straight '
    .replace(/[“”‟″]/g, '"') // curly/double quotes -> straight "
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // drop punctuation (incl. the quotes above and "&") -> space
    .replace(/\band\b/g, " ") // drop the connector word ("&" already became a space)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fold a brand's case, smart quotes, and whitespace but KEEP punctuation/symbols. Used to tell a
 * punctuation-only difference ("Smith & Co" vs "Smith Co", "A-1" vs "A1") apart from a true match:
 * a symbol can distinguish registered brands, so such differences route to review, not auto-pass —
 * while case/space/smart-quote-only differences ("STONE'S THROW" vs "Stone's Throw") still pass.
 */
export function normalizeBrandKeepingSymbols(input: string): string {
  return input
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a government-warning body for WORDING comparison: line-break hyphenation healed,
 * whitespace REMOVED entirely, lowercased. Case is intentionally folded here because the
 * prefix's required CAPITALS are judged from the extracted `warningPrefixIsAllCaps` flag, not
 * re-derived from the raw text.
 *
 * Hyphenation healing exists because narrow labels break the statutory text across lines
 * ("machin-ery") and a verbatim transcription preserves the artifact; the statutory text contains
 * no hyphenated words, so joining "<word>-<whitespace><word>" (and dropping soft hyphens) can
 * never mask a real rewording — any changed WORD still differs after healing.
 *
 * Whitespace is STRIPPED, not collapsed, because real approved labels kern the clause markers
 * tight: a faithful transcription of "(1)According" (no space after the marker — Mossy Horn
 * Pecan, found 2026-06-11) failed the wording check against the canonical "(1) According" and
 * hard-failed a compliant label. Spacing is typography, not wording: a genuine rewording adds,
 * drops, or changes LETTERS, so two texts equal with all whitespace removed print the same
 * statutory words — stripping can never mask a real violation, while mere collapsing still
 * failed kerning artifacts.
 */
export function normalizeWarning(input: string): string {
  return input
    .replace(/­/g, "") // soft hyphens are typography, not text
    .replace(/([a-z])-\s+([a-z])/gi, "$1$2") // heal line-break hyphenation: "machin- ery"
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** Levenshtein edit distance between two strings (pure, O(a*b) time, O(b) space). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Levenshtein is O(a*b): cap inputs so a pasted multi-kilobyte value in a short text field can't
 *  burn CPU in the API route. Label fields are short; 400 chars covers them with a wide margin,
 *  and two values that only diverge past 400 identical characters are the same value to a human. */
const SIMILARITY_MAX_CHARS = 400;

/**
 * Similarity ratio in [0, 1]: 1 = identical, 0 = completely different. Based on normalized edit
 * distance over the longer string. Two empty strings are defined as identical (1).
 */
export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const ca = a.slice(0, SIMILARITY_MAX_CHARS);
  const cb = b.slice(0, SIMILARITY_MAX_CHARS);
  const longer = Math.max(ca.length, cb.length);
  return 1 - levenshtein(ca, cb) / longer;
}
