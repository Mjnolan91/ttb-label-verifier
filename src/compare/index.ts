/**
 * compare/index.ts — public surface of the deterministic comparator.
 */
export type { FieldStatus, FieldResult } from "./types";
export { compareBrand, compareAlcohol, compareWarning } from "./comparators";
export { verifyLabel, overallVerdict, type OverallVerdict, type VerifyResult } from "./verify";
export { normalizeText, normalizeWarning, similarity, levenshtein } from "./text";
export {
  parseAlcoholText,
  resolveBeverageClass,
  isLowOrReducedAlcoholClaim,
  type ParsedAlcohol,
} from "./alcohol";
