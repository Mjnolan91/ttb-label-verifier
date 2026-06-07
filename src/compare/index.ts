/**
 * compare/index.ts — public surface of the deterministic comparator.
 */
export type { FieldStatus, FieldResult } from "./types";
export { compareBrand, compareAlcohol, compareWarning } from "./comparators";
export { normalizeText, normalizeWarning, similarity, levenshtein } from "./text";
export {
  parseAlcoholText,
  resolveBeverageClass,
  isLowOrReducedAlcoholClaim,
  type ParsedAlcohol,
} from "./alcohol";
