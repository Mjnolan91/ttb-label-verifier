/**
 * pipeline.ts — the shared verify orchestration: run the configured provider(s) through the
 * parallel reconciler, decide readability, then the deterministic comparator. Used by BOTH the
 * /api/verify route and the eval harness so the evaluation measures the exact production pipeline.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import { reconcileExtract, type ImageInput, type VisionProvider } from "@/extraction";
import { verifyLabel, isExtractionReadable, type VerifyResult } from "@/compare";

export interface VerificationOutcome {
  /** false => the image was unreadable/low-confidence: re-upload path, no verdict. */
  readable: boolean;
  extracted: ExtractedFields;
  result: VerifyResult | null;
}

/**
 * Extract (reconciling all providers in parallel with a per-call timeout), gate on readability,
 * then compare. Returns the reconciled extraction plus the verdict (null when unreadable).
 */
export async function runVerification(
  providers: VisionProvider[],
  claimed: ClaimedFields,
  image: ImageInput,
  timeoutMs?: number,
): Promise<VerificationOutcome> {
  const extracted = await reconcileExtract(providers, image, timeoutMs);
  if (!isExtractionReadable(extracted)) {
    return { readable: false, extracted, result: null };
  }
  return { readable: true, extracted, result: verifyLabel(claimed, extracted) };
}
