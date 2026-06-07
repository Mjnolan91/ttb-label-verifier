/**
 * compare/types.ts — result shapes for the deterministic comparator.
 *
 * The comparator is the "code compares" half of the architecture: pure, side-effect-free, and
 * unit-tested. A model NEVER produces these verdicts — they must be rules-based and reproducible
 * so "why was this rejected?" always has an auditable, CFR-grounded answer.
 */

/** Per-field verdict. `review` routes uncertainty to a human (asymmetric: bias away from false approval). */
export type FieldStatus = "pass" | "review" | "fail";

/** The result of comparing one field: the verdict plus the two values and a plain-language reason. */
export interface FieldResult {
  status: FieldStatus;
  /** Human-readable claimed/expected value (for side-by-side display). */
  claimed: string;
  /** Human-readable extracted value (for side-by-side display). */
  extracted: string;
  /** One-line, plain-language explanation a human agent can trust or override. */
  reason: string;
}
