/**
 * extractedShape.ts — the on-the-wire "raw extraction" shape and its mapping to ExtractedFields.
 *
 * Both the mock (reading eval/fixtures/cases.json) and the real LLM provider (parsing the
 * model's JSON) produce this same `{ value, confidence }`-per-field shape, so the mapping lives
 * once here. This is the boundary where probabilistic extraction becomes the typed domain object
 * the deterministic comparator consumes.
 */
import type { ExtractedFields, FieldConfidence } from "@/domain";
import { FIELD_CATALOG } from "./fieldCatalog";

/** A single read field: the value plus the provider's confidence in it. */
export interface RawConfidencedValue {
  value: string;
  confidence: number;
}

/** The raw extraction block (matches cases.json `extracted` and the LLM JSON schema). */
export interface RawExtractedFields {
  brand?: RawConfidencedValue;
  classType?: RawConfidencedValue;
  alcoholContent?: RawConfidencedValue;
  netContents?: RawConfidencedValue;
  warningText?: RawConfidencedValue;
  class?: RawConfidencedValue;
  name?: RawConfidencedValue;
  address?: RawConfidencedValue;
  countryOfOrigin?: RawConfidencedValue;
  importerStatement?: RawConfidencedValue;
  appellation?: RawConfidencedValue;
  vintage?: RawConfidencedValue;
  varietal?: RawConfidencedValue;
  sulfiteDeclaration?: RawConfidencedValue;
  ageStatement?: RawConfidencedValue;
  commodityStatement?: RawConfidencedValue;
  fancifulName?: RawConfidencedValue;
  statementOfComposition?: RawConfidencedValue;
  warningPrefixIsAllCaps: boolean | null;
  warningPrefixIsBold: boolean | null;
  /** Supplementary 16.22 signals (optional: older fixtures don't carry them). */
  warningRemainderIsBold?: boolean | null;
  warningIsReadilyLegible?: boolean | null;
}

/**
 * Collapse a value that is literally the SAME READING TWICE. A joint front+back read sometimes
 * transcribes a fact printed on both panels into one field ("750 mL 750 ML", "ALC. 33% ... twice"),
 * and the duplicate then rides into the suggestion, the field table, and the exports. The collapse
 * is deliberately strict, so a real value can never be halved:
 *  - it applies only to DIGIT-BEARING values: the double-print bug is a numeric-fact phenomenon
 *    (net contents, alcohol statements), and no legal single value repeats a digit-bearing phrase,
 *    while name-like values legitimately double ("Walla Walla", "New York, New York") and must
 *    never be touched;
 *  - the two halves must be identical once case, whitespace, and separator punctuation are folded;
 *  - the split point must fall AT a printed separator (whitespace or punctuation) in the original,
 *    so a single continuous token ("5050", "ABAB") is never split.
 * The first reading is returned as printed (its casing wins). Three-or-more repeats stay untouched
 * (halves won't match), which is the conservative side of the trade.
 */
export function dedupeRepeatedRead(value: string): string {
  if (!/\d/.test(value)) return value; // name-like values legitimately double; never touch them
  const SEPARATOR = /[\s.,;:|/()\\-]/;
  // The compact spelling (folded case, separators dropped) plus, per compact char, its index in
  // the original string and whether a separator run sits immediately before it.
  const chars: { c: string; at: number; sepBefore: boolean }[] = [];
  let sepRun = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (SEPARATOR.test(ch)) {
      sepRun = true;
      continue;
    }
    chars.push({ c: ch.toLowerCase(), at: i, sepBefore: sepRun });
    sepRun = false;
  }
  const n = chars.length;
  // Half >= 3 compact chars: a tiny doubled token ("50/50", "5 5") is more plausibly a real value
  // (a brand, a fraction) than a double transcription of one printed fact.
  if (n < 6 || n % 2 !== 0) return value;
  const half = n / 2;
  if (!chars[half].sepBefore) return value; // the repeat must start at a printed separator
  for (let i = 0; i < half; i++) {
    if (chars[i].c !== chars[half + i].c) return value;
  }
  // Cut the original just before the second reading begins, then drop the trailing LINKING
  // separators (space, slash, comma...) plus any dangling OPENING bracket ("750 mL (750 ML)"
  // cuts to "750 mL (" without it). A closing ")" stays: it belongs to the first reading
  // ("(66 PROOF)"); brackets only fold for the half comparison above.
  return value.slice(0, chars[half].at).replace(/[\s.,;:|/\\({[-]+$/, "");
}

/**
 * Map a raw extraction block to the domain `ExtractedFields`. Values (including empty strings) are
 * passed through verbatim — an empty warningText at HIGH confidence means "confidently absent"
 * (a real violation), distinct from the all-low-confidence unreadable case. Alcohol is carried as
 * raw text (`alcoholContentText`); the comparator parses it. ONE exception to verbatim: a value
 * that is the same reading printed twice collapses to its first reading (dedupeRepeatedRead) —
 * except warningText, whose statutory comparison must always see the honest transcription.
 */
export function mapRawExtracted(raw: RawExtractedFields): ExtractedFields {
  const confidence: FieldConfidence = {};
  // The warning format flags are booleans (not confidenced values), so they're carried explicitly;
  // every confidenced value field is mapped generically from the catalog.
  const out: ExtractedFields = {
    warningPrefixIsAllCaps: raw.warningPrefixIsAllCaps,
    warningPrefixIsBold: raw.warningPrefixIsBold,
    warningRemainderIsBold: raw.warningRemainderIsBold ?? null,
    warningIsReadilyLegible: raw.warningIsReadilyLegible ?? null,
    confidence,
  };
  const rawByKey = raw as unknown as Record<string, RawConfidencedValue | undefined>;
  const outByKey = out as unknown as Record<string, unknown>;
  for (const d of FIELD_CATALOG) {
    const cell = rawByKey[d.rawKey];
    if (cell) {
      outByKey[d.key] = d.key === "warningText" ? cell.value : dedupeRepeatedRead(cell.value);
      confidence[d.confKey] = cell.confidence;
    }
  }
  return out;
}
