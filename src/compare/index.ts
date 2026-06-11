/**
 * compare/index.ts — public surface of the deterministic comparator.
 */
export type { FieldStatus, FieldResult } from "./types";
export {
  compareBrand,
  compareAlcohol,
  compareWarning,
  compareNetContents,
  compareClassType,
  compareName,
  compareAddress,
  compareOrigin,
  compareFancifulName,
  compareStatementOfComposition,
} from "./comparators";
export {
  verifyLabel,
  overallVerdict,
  type OverallVerdict,
  type VerifyResult,
  type VerifyField,
  type VerifyFieldKey,
} from "./verify";
export {
  checkCompleteness,
  resolveCompletenessOverall,
  type CompletenessResult,
  type CompletenessElement,
  type CompletenessOverall,
  type ElementStatus,
  type ReviewOverride,
} from "./completeness";
export {
  MIN_READABLE_CONFIDENCE,
  isExtractionReadable,
  FIELD_REVIEW_CONFIDENCE,
  applyConfidenceGate,
} from "./thresholds";
export { normalizeText, normalizeWarning, similarity, levenshtein } from "./text";
export { combinedVerdict, worstVerdict, toClaimedFields, type CombinedVerdict } from "./reviewVerdict";
export {
  requiredInputKeysFor,
  classChoiceFor,
  CLASS_CHOICES,
  type ClassChoice,
} from "./requiredInputs";
export {
  parseAlcoholText,
  resolveBeverageClass,
  isLowOrReducedAlcoholClaim,
  type ParsedAlcohol,
} from "./alcohol";
export {
  inferOrigin,
  isUsAddress,
  isForeignAddress,
  suggestedCountryOfOrigin,
  namedCountryIn,
  type OriginInference,
  type OriginEvidence,
} from "./origin";
