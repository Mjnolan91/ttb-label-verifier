/**
 * domain/index.ts — Public surface of the CFR-verified domain module.
 *
 * This is the ONE module that is human-trusted rather than loop-generated. Its constants
 * (the canonical warning, the tolerance values, the warning threshold) are statutory and
 * MUST NOT be changed to make a test pass. See ./README.md.
 *
 * Re-exports everything callers (extraction, comparator, UI, eval) should depend on, so
 * they import from "@/domain" / "../domain" rather than reaching into individual files.
 */

// Canonical government warning + its mandatory prefix and formatting note.
export {
  CANONICAL_GOVERNMENT_WARNING,
  GOVERNMENT_WARNING_PREFIX,
  GOVERNMENT_WARNING_PREFIX_FORMAT_NOTE,
} from "./warning";

// Shared field types and the beverage-class union.
export type {
  BeverageClass,
  AlcoholContent,
  FieldConfidence,
  ClaimedFields,
  ExtractedFields,
} from "./types";

// Tolerance table + the classType -> tolerance selector.
export {
  TOLERANCE_TABLE,
  selectToleranceFor,
} from "./tolerances";
export type { ToleranceRule } from "./tolerances";

// Pure alcohol helpers + the warning-exemption threshold.
export {
  proofToAbv,
  abvToProof,
  isWarningRequired,
  WARNING_REQUIRED_ABV_THRESHOLD,
} from "./alcohol";

// TTB mandatory label-element matrix per beverage class (drives the completeness check).
export { mandatoryElementsFor } from "./labelRequirements";
export type { RequirementKey, RequirementSpec } from "./labelRequirements";
