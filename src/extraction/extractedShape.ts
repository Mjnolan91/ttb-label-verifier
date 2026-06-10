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
 * Map a raw extraction block to the domain `ExtractedFields`. Values (including empty strings) are
 * passed through verbatim — an empty warningText at HIGH confidence means "confidently absent"
 * (a real violation), distinct from the all-low-confidence unreadable case. Alcohol is carried as
 * raw text (`alcoholContentText`); the comparator parses it.
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
      outByKey[d.key] = cell.value;
      confidence[d.confKey] = cell.confidence;
    }
  }
  return out;
}
