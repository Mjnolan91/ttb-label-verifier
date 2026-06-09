/**
 * compare/text.ts — pure text-normalization + similarity helpers used by the comparators.
 */

/**
 * Normalize a brand-like string for TOLERANT comparison:
 *   smart quotes -> straight, lowercased, punctuation -> space, whitespace collapsed, trimmed.
 * So "STONE’S THROW" and "Stone’s Throw" both become "stone s throw" (a pass), while a real
 * character difference (an inserted letter) survives as a difference (routed to review).
 */
export function normalizeText(input: string): string {
  return input
    .replace(/[‘’‛′]/g, "'") // curly/single quotes -> straight '
    .replace(/[“”‟″]/g, '"') // curly/double quotes -> straight "
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // drop punctuation (incl. the quotes above) -> space
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
 * Normalize a government-warning body for WORDING comparison: whitespace collapsed, trimmed,
 * lowercased. Case is intentionally folded here because the prefix's required CAPITALS are
 * judged from the extracted `warningPrefixIsAllCaps` flag, not re-derived from the raw text.
 */
export function normalizeWarning(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
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

/**
 * Similarity ratio in [0, 1]: 1 = identical, 0 = completely different. Based on normalized edit
 * distance over the longer string. Two empty strings are defined as identical (1).
 */
export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const longer = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / longer;
}
