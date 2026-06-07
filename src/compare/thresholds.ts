/**
 * compare/thresholds.ts — confidence thresholds (asymmetric, compliance-aware).
 *
 * Cost-of-errors rationale: a missed violation (false approval) is far worse than an unnecessary
 * human review. So nothing is asserted from a low-confidence read — it is routed to review or, when
 * NOTHING could be read, to the "re-upload a clearer photo" path. Never auto-approve what we could
 * not read.
 *
 * US-008 uses the readability floor below. US-011 EXTENDS this file with the per-field review gate
 * (downgrade an individual low-confidence field to `review`) and its boundary tests.
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
 * Is there ANY confidently-read field? false => unreadable/low-confidence => re-upload path
 * (US-008), never a verdict. true => proceed to comparison (individual low-confidence fields are
 * routed to review by the US-011 gate).
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
 * Apply the asymmetric confidence gate to one field result: a `pass` or `fail` below the threshold
 * is downgraded to `review` (never assert a verdict we are not confident in); an existing `review`
 * is left as-is. The original reason is preserved so the human reviewer sees the underlying check.
 */
export function applyConfidenceGate(
  result: FieldResult,
  confidence: number | undefined,
  threshold: number = FIELD_REVIEW_CONFIDENCE,
): FieldResult {
  if (result.status === "review") return result;
  const c = confidence ?? 0;
  if (c < threshold) {
    return {
      ...result,
      status: "review",
      reason: `Low extraction confidence (${Math.round(c * 100)}%) — routed to human review. ${result.reason}`,
    };
  }
  return result;
}
