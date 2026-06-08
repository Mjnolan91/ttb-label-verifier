/**
 * pipeline.ts — the shared orchestration. `runExtraction` reads EVERY image of a product
 * (front/back/neck) in parallel and MERGES them into one record (a back-label field fills in the
 * front), then gates readability — this is the PRIMARY path. `runVerification` adds the optional
 * claimed-comparison verdict. Used by BOTH the /api/verify route and the eval harness so the
 * evaluation measures the exact production pipeline.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import { reconcileExtract, mergeExtracted, isAbortOrTimeout, type ImageInput, type VisionProvider } from "@/extraction";
import { verifyLabel, isExtractionReadable, type VerifyResult } from "@/compare";

export interface ExtractionOutcome {
  /** false => the merged read was unreadable/low-confidence: re-upload path, no trustworthy fields. */
  readable: boolean;
  extracted: ExtractedFields;
}

export interface VerificationOutcome extends ExtractionOutcome {
  /** The verdict, or null when unreadable (or when no claimed values were supplied to compare). */
  result: VerifyResult | null;
}

/**
 * Read each of a product's images in parallel (each through the provider reconciler with its per-call
 * timeout), then merge them into one ExtractedFields. A product is usually one image; front+back is
 * common. An image whose read fails drops out; only if NONE read do we surface a timeout/error.
 */
export async function runExtraction(
  providers: VisionProvider[],
  images: ImageInput[],
  timeoutMs?: number,
): Promise<ExtractionOutcome> {
  if (images.length === 0) throw new Error("At least one image is required.");
  const settled = await Promise.allSettled(
    images.map((img) => reconcileExtract(providers, img, timeoutMs)),
  );
  const reads = settled
    .filter((s): s is PromiseFulfilledResult<ExtractedFields> => s.status === "fulfilled")
    .map((s) => s.value);

  if (reads.length === 0) {
    const reasons = settled.map((s) => (s.status === "rejected" ? (s.reason as unknown) : undefined));
    if (reasons.every((r) => isAbortOrTimeout(r))) {
      throw new DOMException("All label images timed out.", "TimeoutError");
    }
    throw reasons.find((r): r is Error => r instanceof Error) ?? new Error("Failed to read the label images.");
  }

  const extracted = reads.reduce((acc, cur) => mergeExtracted(acc, cur));
  return { readable: isExtractionReadable(extracted), extracted };
}

/**
 * Extract, then (when readable) compare against the claimed application values. Returns the merged
 * extraction plus the verdict (null when unreadable).
 */
export async function runVerification(
  providers: VisionProvider[],
  claimed: ClaimedFields,
  images: ImageInput[],
  timeoutMs?: number,
): Promise<VerificationOutcome> {
  const { readable, extracted } = await runExtraction(providers, images, timeoutMs);
  if (!readable) {
    return { readable, extracted, result: null };
  }
  return { readable, extracted, result: verifyLabel(claimed, extracted) };
}
