/**
 * pipeline.ts — the shared orchestration. `runExtraction` reads EVERY image of a product
 * (front/back/neck) in parallel and MERGES them into one record (a back-label field fills in the
 * front), then gates readability — this is the PRIMARY path. `runVerification` adds the optional
 * claimed-comparison verdict. Used by BOTH the /api/verify route and the eval harness so the
 * evaluation measures the exact production pipeline.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import { selfConsistentExtract, resolveSelfConsistencySamples, resolveWarningJudgeSamples, resolveRescueTimeoutMs, resolveTimeoutMs, mergeExtracted, harvestOriginStatement, isAbortOrTimeout, aggregateBoldVotes, combineBoldSignals, resolveLowConfidenceRescue, rescueEligibleKeys, rescueRawKeys, applyRescue, readFieldsBounded, type ImageInput, type LabelPosition, type VisionProvider } from "@/extraction";
import { verifyLabel, isExtractionReadable, type VerifyResult } from "@/compare";

/** One image of the product that could not be read while at least one other image succeeded. */
export interface ImageReadFailure {
  filename: string;
  position?: LabelPosition;
  reason: "timeout" | "error";
}

export interface ExtractionOutcome {
  /** false => the merged read was unreadable/low-confidence: re-upload path, no trustworthy fields. */
  readable: boolean;
  extracted: ExtractedFields;
  /**
   * Images that dropped out of the merge. A dropped back label must NEVER masquerade as a clean
   * "the label has no net contents" read — the route forwards these so the UI can warn and offer a
   * retry (the silent-drop failure mode behind the 2026-06-10 Bonnaire investigation).
   */
  failedImages: ImageReadFailure[];
}

export interface VerificationOutcome extends ExtractionOutcome {
  /** The verdict, or null when unreadable (or when no claimed values were supplied to compare). */
  result: VerifyResult | null;
}

/**
 * Read each of a product's images in parallel (each through the provider reconciler with its per-call
 * timeout), then merge them into one ExtractedFields. A product is usually one image; front+back is
 * common. An image whose read fails drops out of the merge and is REPORTED in `failedImages` (the
 * route forwards it as `imageFailures`; the UIs warn and offer a retry — a dropped image must never
 * masquerade as a clean read). Only if NONE read do we surface a timeout/error.
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
  // ONE per-call budget for everything in this read (otherwise extraction and the judge fall back to
  // different defaults when the caller omits timeoutMs).
  const perCallTimeoutMs = timeoutMs ?? resolveTimeoutMs(providers);
  // The judge rides the same budget as extraction: on timeout the in-flight call is ABORTED (the
  // providers plumb the signal into their fetch) and the verdict degrades to null ("cannot assert"),
  // the same safe state as a judge that couldn't tell — a lone "not bold" never hard-fails anyway
  // (combineBoldSignals). The race stays as a backstop for providers that ignore the signal.
  const judgeOnce = (img: ImageInput): Promise<boolean | null> => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      bolder!.judgeWarningBold!(img, ctrl.signal)
        .catch(() => null)
        .finally(() => clearTimeout(timer)),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          ctrl.abort();
          resolve(null);
        }, perCallTimeoutMs);
      }),
    ]);
  };
  // The judge fan-out is CAPPED below the extraction width (default 3): it answers one boolean on
  // the strong model, and judge calls are the cheapest place to shrink the per-verify request burst.
  const judgeSamples = resolveWarningJudgeSamples(samples);
  const [settled, boldVerdicts] = await Promise.all([
    Promise.allSettled(images.map((img) => selfConsistentExtract(providers, img, perCallTimeoutMs, samples))),
    bolder
      ? Promise.all(
          images.map((img) =>
            Promise.all(Array.from({ length: judgeSamples }, () => judgeOnce(img))).then(aggregateBoldVotes),
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

  // Record which images dropped out (the merge proceeds from the survivors). Indexes align: settled
  // was produced by mapping over `images`.
  const failedImages: ImageReadFailure[] = images.flatMap((image, i) => {
    const s = settled[i];
    if (s.status !== "rejected") return [];
    return [
      {
        filename: image.filename,
        position: image.position,
        reason: isAbortOrTimeout(s.reason) ? ("timeout" as const) : ("error" as const),
      },
    ];
  });

  const extracted = reads.reduce((acc, cur) => mergeExtracted(acc, cur));

  // Deterministic origin harvesting: a printed "PRODUCT OF <country>" the samples misallocated to a
  // sibling field fills an EMPTY countryOfOrigin (plain code over already-read text — see harvest.ts).
  harvestOriginStatement(extracted);

  // Apply the dedicated bold judgment ONLY when a warning was read AND a judge actually ran. The warning
  // may be on the back label, so take the first non-null verdict across images. COMBINE it with the
  // extraction model's own bold flag rather than clobbering: "not bold" (the hard-fail signal) holds only
  // when both agree, so one weak visual judgment can't reject a compliant label. (No judge -> leave the
  // extraction flag untouched, keeping the offline mock + eval deterministic.)
  if (bolder && extracted.warningText && extracted.warningText.trim() !== "") {
    const judge = boldVerdicts.find((v) => v !== null) ?? null;
    extracted.warningPrefixIsBold = combineBoldSignals(extracted.warningPrefixIsBold, judge);
  }

  // LOW-CONFIDENCE RESCUE (rescue.ts): when verdict-relevant fields land in the borderline band,
  // ONE bounded call re-reads exactly those fields on the provider's strongest model across ALL the
  // product's images. Agreement clears the review gate; disagreement adopts the stronger read but
  // stays in review. Fires only on contested reads; the mock has no readFields, so the offline
  // suite and eval never enter this branch. A failed/timed-out rescue leaves the extraction as-is.
  const rescuer = providers.find((p) => typeof p.readFields === "function");
  if (rescuer && isExtractionReadable(extracted) && resolveLowConfidenceRescue()) {
    const contested = rescueEligibleKeys(extracted);
    if (contested.length > 0) {
      // The rescue gets its OWN budget (resolveRescueTimeoutMs, >= 10s by default): it runs on the
      // strongest model, whose single read can exceed a tight per-sample straggler cap — sharing
      // that cap made the rescue a guaranteed timeout (dead wall-clock, zero effect).
      const strong = await readFieldsBounded(
        rescuer,
        images,
        rescueRawKeys(contested),
        resolveRescueTimeoutMs(perCallTimeoutMs),
      );
      if (strong) applyRescue(extracted, contested, strong);
    }
  }

  return { readable: isExtractionReadable(extracted), extracted, failedImages };
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
  const { readable, extracted, failedImages } = await runExtraction(providers, images, timeoutMs);
  if (!readable) {
    return { readable, extracted, failedImages, result: null };
  }
  return { readable, extracted, failedImages, result: verifyLabel(claimed, extracted) };
}
