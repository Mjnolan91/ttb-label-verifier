/**
 * pipeline.ts — the shared orchestration. `runExtraction` reads EVERY image of a product
 * (front/back/neck) in parallel and MERGES them into one record (a back-label field fills in the
 * front), then gates readability — this is the PRIMARY path. `runVerification` adds the optional
 * claimed-comparison verdict. Used by BOTH the /api/verify route and the eval harness so the
 * evaluation measures the exact production pipeline.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import { selfConsistentExtract, resolveSelfConsistencySamples, mergeExtracted, isAbortOrTimeout, aggregateBoldVotes, combineBoldSignals, type ImageInput, type VisionProvider } from "@/extraction";
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
  const samples = providers.every((p) => p.name === "mock") ? 1 : resolveSelfConsistencySamples();

  // Run the per-image reads AND the dedicated bold-judgment pass CONCURRENTLY. The bold pass needs
  // only the image bytes (not the extracted fields), so waiting for extraction to finish before
  // starting it just stacks a whole model round-trip onto the latency budget. Start both at once and
  // apply the bold verdict afterward, only when a warning was actually read. (Trade-off: on a label
  // with no warning the speculative bold call is wasted — but a warning is mandatory on TTB labels
  // ≥0.5% ABV, so this nets a large latency win for the common case.) The bold pass is SAMPLED N times
  // per image (self-consistency) and majority-voted, since a false "not bold" hard-fails the warning.
  const bolder = providers.find((p) => typeof p.judgeWarningBold === "function");
  const [settled, boldVerdicts] = await Promise.all([
    Promise.allSettled(images.map((img) => selfConsistentExtract(providers, img, timeoutMs, samples))),
    bolder
      ? Promise.all(
          images.map((img) =>
            Promise.all(
              Array.from({ length: samples }, () => bolder.judgeWarningBold!(img).catch(() => null)),
            ).then(aggregateBoldVotes),
          ),
        )
      : Promise.resolve<(boolean | null)[]>([]),
  ]);

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

  // Apply the dedicated bold judgment ONLY when a warning was read AND a judge actually ran. The warning
  // may be on the back label, so take the first non-null verdict across images. COMBINE it with the
  // extraction model's own bold flag rather than clobbering: "not bold" (the hard-fail signal) holds only
  // when both agree, so one weak visual judgment can't reject a compliant label. (No judge -> leave the
  // extraction flag untouched, keeping the offline mock + eval deterministic.)
  if (bolder && extracted.warningText && extracted.warningText.trim() !== "") {
    const judge = boldVerdicts.find((v) => v !== null) ?? null;
    extracted.warningPrefixIsBold = combineBoldSignals(extracted.warningPrefixIsBold, judge);
  }

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
