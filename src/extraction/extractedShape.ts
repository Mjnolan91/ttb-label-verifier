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
  nameAndAddress?: RawConfidencedValue;
  countryOfOrigin?: RawConfidencedValue;
  appellation?: RawConfidencedValue;
  vintage?: RawConfidencedValue;
  varietal?: RawConfidencedValue;
  sulfiteDeclaration?: RawConfidencedValue;
  ageStatement?: RawConfidencedValue;
  commodityStatement?: RawConfidencedValue;
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
  if (raw.nameAndAddress) confidence.nameAndAddress = raw.nameAndAddress.confidence;
  if (raw.countryOfOrigin) confidence.countryOfOrigin = raw.countryOfOrigin.confidence;
  if (raw.appellation) confidence.appellation = raw.appellation.confidence;
  if (raw.vintage) confidence.vintage = raw.vintage.confidence;
  if (raw.varietal) confidence.varietal = raw.varietal.confidence;
  if (raw.sulfiteDeclaration) confidence.sulfiteDeclaration = raw.sulfiteDeclaration.confidence;
  if (raw.ageStatement) confidence.ageStatement = raw.ageStatement.confidence;
  if (raw.commodityStatement) confidence.commodityStatement = raw.commodityStatement.confidence;

  return {
    brand: raw.brand?.value,
    classType: raw.classType?.value,
    alcoholContentText: raw.alcoholContent?.value,
    netContents: raw.netContents?.value,
    warningText: raw.warningText?.value,
    nameAndAddress: raw.nameAndAddress?.value,
    countryOfOrigin: raw.countryOfOrigin?.value,
    appellation: raw.appellation?.value,
    vintage: raw.vintage?.value,
    varietal: raw.varietal?.value,
    sulfiteDeclaration: raw.sulfiteDeclaration?.value,
    ageStatement: raw.ageStatement?.value,
    commodityStatement: raw.commodityStatement?.value,
    warningPrefixIsAllCaps: raw.warningPrefixIsAllCaps,
    warningPrefixIsBold: raw.warningPrefixIsBold,
    confidence,
  };
}
