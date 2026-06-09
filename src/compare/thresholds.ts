/**
 * compare/thresholds.ts — confidence thresholds (asymmetric, compliance-aware).
 *
 * Cost-of-errors rationale: a missed violation (false approval) is far worse than an unnecessary
 * human review. So nothing is asserted from a low-confidence read — it is routed to review or, when
 * NOTHING could be read, to the "re-upload a clearer photo" path. Never auto-approve what we could
 * not read.
 *
 * The readability floor below drives the re-upload path; the per-field review gate (downgrade an
 * individual low-confidence field to `review`) extends it with its own boundary tests.
 */
import type { ExtractedFields } from "@/domain";
import type { FieldResult } from "./types";

/**
 * Minimum per-field confidence at/above which a read counts as usable signal. If EVERY field is
 * below this, the extractor essentially read nothing (a blurry/glare photo, or an image the mock
 * doesn't recognize), so we treat the image as UNREADABLE and ask for a re-upload rather than
 * fabricating a verdict. Chosen well below the ~0.9+ confidences of clean reads and above the
 * ~0.3 of the deliberately-unreadable fixture.
 */
export const MIN_READABLE_CONFIDENCE = 0.5;

/**
 * Is there ANY confidently-read field? false => unreadable/low-confidence => re-upload path,
 * never a verdict. true => proceed to comparison (individual low-confidence fields are
 * routed to review by the per-field gate).
 */
export function isExtractionReadable(
  extracted: ExtractedFields,
  min: number = MIN_READABLE_CONFIDENCE,
): boolean {
  const confidences = Object.values(extracted.confidence).filter(
    (c): c is number => typeof c === "number",
  );
  if (confidences.length === 0) return false;
  return Math.max(...confidences) >= min;
}

/**
 * A field's value-based verdict (pass/fail) is TRUSTED only at/above this extraction confidence;
 * below it, the field is routed to `review` instead of asserting a verdict.
 *
 * Set deliberately HIGH (asymmetric, compliance-aware): a missed violation (false approval) is far
 * worse than an unnecessary human review, so we bias toward review whenever a read is not clearly
 * trustworthy — including the low confidence the reconciler assigns to fields where two extractors
 * DISAGREE. Distinct from MIN_READABLE_CONFIDENCE, which decides whether the image is readable at
 * all (re-upload) rather than how much to trust an individual field.
 */
export const FIELD_REVIEW_CONFIDENCE = 0.7;

/**
 * Apply the asymmetric confidence gate to one field result: a `pass` or `fail` whose read confidence
 * is below the threshold is downgraded to `review` (never assert a verdict we are not confident in);
 * an existing `review` is left as-is.
 *
 * Crucially this is now ADDITIVE, not destructive. The gated `status` is unchanged in meaning (still
 * `review` when gated, so the reduction and the eval are byte-for-byte identical), but we also record
 * the value comparison's ORIGINAL verdict (`valueStatus`), whether the downgrade was confidence-driven
 * (`gatedByConfidence`), and the confidence number itself (`readConfidence`). That lets the UI tell
 * "the values matched, just confirm the fuzzy photo" apart from "the values disagree" — the two states
 * that used to collapse into one indistinguishable orange "Needs review" card.
 *
 * The reason is composed POSITIVE-FIRST: the value outcome ("Brand matches…") leads and the photo
 * caveat follows, so a matching field never reads like a rejection.
 */
export function applyConfidenceGate(
  result: FieldResult,
  confidence: number | undefined,
  threshold: number = FIELD_REVIEW_CONFIDENCE,
): FieldResult {
  const c = confidence ?? 0;
  // An already-`review` value verdict (e.g. a close-but-not-identical brand) is value uncertainty,
  // not a confidence downgrade — record the confidence but don't claim it was confidence-gated.
  if (result.status === "review") {
    return { ...result, valueStatus: "review", gatedByConfidence: false, readConfidence: c };
  }
  if (c < threshold) {
    return {
      ...result,
      status: "review", // STILL review — compliance posture unchanged, only the presentation gains nuance
      valueStatus: result.status, // remember the pass/fail the values actually produced
      gatedByConfidence: true,
      readConfidence: c,
      reason: `${result.reason} We're only ${Math.round(c * 100)}% sure we read this off the photo — open the label image to confirm before approving.`,
    };
  }
  // Confident enough: keep the value verdict, but still expose the confidence so every card can show it.
  return { ...result, valueStatus: result.status, gatedByConfidence: false, readConfidence: c };
}
