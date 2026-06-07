/**
 * extractedShape.ts — the on-the-wire "raw extraction" shape and its mapping to ExtractedFields.
 *
 * Both the mock (reading eval/fixtures/cases.json) and the real LLM provider (US-009, parsing the
 * model's JSON) produce this same `{ value, confidence }`-per-field shape, so the mapping lives
 * once here. This is the boundary where probabilistic extraction becomes the typed domain object
 * the deterministic comparator consumes.
 */
import type { ExtractedFields, FieldConfidence } from "@/domain";

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
  warningPrefixIsAllCaps: boolean;
  warningPrefixIsBold: boolean | null;
}

/**
 * Map a raw extraction block to the domain `ExtractedFields`. Values (including empty strings) are
 * passed through verbatim — an empty warningText at HIGH confidence means "confidently absent"
 * (a real violation), distinct from the all-low-confidence unreadable case. Alcohol is carried as
 * raw text (`alcoholContentText`); the comparator parses it.
 */
export function mapRawExtracted(raw: RawExtractedFields): ExtractedFields {
  const confidence: FieldConfidence = {};
  if (raw.brand) confidence.brand = raw.brand.confidence;
  if (raw.classType) confidence.classType = raw.classType.confidence;
  if (raw.alcoholContent) confidence.alcoholContent = raw.alcoholContent.confidence;
  if (raw.netContents) confidence.netContents = raw.netContents.confidence;
  if (raw.warningText) confidence.warningText = raw.warningText.confidence;

  return {
    brand: raw.brand?.value,
    classType: raw.classType?.value,
    alcoholContentText: raw.alcoholContent?.value,
    netContents: raw.netContents?.value,
    warningText: raw.warningText?.value,
    warningPrefixIsAllCaps: raw.warningPrefixIsAllCaps,
    warningPrefixIsBold: raw.warningPrefixIsBold,
    confidence,
  };
}
