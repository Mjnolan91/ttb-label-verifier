/**
 * pipeline.ts — the shared orchestration. `runExtraction` reads a label (reconcile the configured
 * provider(s) in parallel, gate on readability) and is the PRIMARY path; `runVerification` adds the
 * deterministic comparison when claimed application values are supplied (optional). Used by BOTH the
 * /api/verify route and the eval harness so the evaluation measures the exact production pipeline.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import { reconcileExtract, type ImageInput, type VisionProvider } from "@/extraction";
import { verifyLabel, isExtractionReadable, type VerifyResult } from "@/compare";

export interface ExtractionOutcome {
  /** false => the image was unreadable/low-confidence: re-upload path, no trustworthy fields. */
  readable: boolean;
  extracted: ExtractedFields;
}

export interface VerificationOutcome extends ExtractionOutcome {
  /** The verdict, or null when unreadable (or when no claimed values were supplied to compare). */
  result: VerifyResult | null;
}

/**
 * Extraction-first path: reconcile all providers in parallel (per-call timeout), then report whether
 * the read is trustworthy. No comparison — this is what the AI-reads-the-label flow uses.
 */
export async function runExtraction(
  providers: VisionProvider[],
  image: ImageInput,
  timeoutMs?: number,
): Promise<ExtractionOutcome> {
  const extracted = await reconcileExtract(providers, image, timeoutMs);
  return { readable: isExtractionReadable(extracted), extracted };
}

/**
 * Extract, then (when readable) compare against the claimed application values. Returns the
 * reconciled extraction plus the verdict (null when unreadable).
 */
export async function runVerification(
  providers: VisionProvider[],
  claimed: ClaimedFields,
  image: ImageInput,
  timeoutMs?: number,
): Promise<VerificationOutcome> {
  const { readable, extracted } = await runExtraction(providers, image, timeoutMs);
  if (!readable) {
    return { readable, extracted, result: null };
  }
  return { readable, extracted, result: verifyLabel(claimed, extracted) };
}
