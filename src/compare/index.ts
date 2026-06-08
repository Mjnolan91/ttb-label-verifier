/**
 * compare/index.ts — public surface of the deterministic comparator.
 */
export type { FieldStatus, FieldResult } from "./types";
export { compareBrand, compareAlcohol, compareWarning } from "./comparators";
export { verifyLabel, overallVerdict, type OverallVerdict, type VerifyResult } from "./verify";
export {
  checkCompleteness,
  type CompletenessResult,
  type CompletenessElement,
  type CompletenessOverall,
  type ElementStatus,
} from "./completeness";
export {
  MIN_READABLE_CONFIDENCE,
  isExtractionReadable,
  FIELD_REVIEW_CONFIDENCE,
  applyConfidenceGate,
} from "./thresholds";
export { normalizeText, normalizeWarning, similarity, levenshtein } from "./text";
export { combinedVerdict, worstVerdict, type CombinedVerdict } from "./reviewVerdict";
export {
  parseAlcoholText,
  resolveBeverageClass,
  isLowOrReducedAlcoholClaim,
  type ParsedAlcohol,
} from "./alcohol";
