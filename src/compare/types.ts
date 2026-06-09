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
  /**
   * The AUTHORITATIVE verdict the rest of the system reduces on. The confidence gate may downgrade a
   * `pass`/`fail` to `review` here (never auto-approve a read we can't trust) — so this is the gated
   * status, not necessarily the value comparison's outcome. See `valueStatus`.
   */
  status: FieldStatus;
  /** Human-readable claimed/expected value (for side-by-side display). */
  claimed: string;
  /** Human-readable extracted value (for side-by-side display). */
  extracted: string;
  /** One-line, plain-language explanation a human agent can trust or override. */
  reason: string;
  /**
   * The value comparison's verdict BEFORE the confidence gate ran. Present whenever the gate was
   * applied. Lets the UI show "the values actually matched" even when `status` was downgraded to
   * `review` purely because the photo read was fuzzy — the difference between "they disagree" and
   * "they agree, just confirm the photo". Absent ⇒ no gate ran (e.g. the exempt-warning path), so
   * `status` already IS the value verdict.
   */
  valueStatus?: FieldStatus;
  /**
   * True iff the confidence gate downgraded `valueStatus` → `status` (i.e. `status` is `review` only
   * because the read confidence was below the trust threshold, NOT because the values disagree). THE
   * discriminator the UI keys the calm "Match · confirm photo" treatment off. Never affects the
   * reduced verdict — presentation only.
   */
  gatedByConfidence?: boolean;
  /** The per-field extraction confidence (0..1) the gate evaluated, so the UI can show "we're 67%
   *  sure we read this off the photo" as a number rather than buried in prose. Present when gated. */
  readConfidence?: number;
}
