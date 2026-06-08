/**
 * reconcile.ts — run multiple VisionProviders in PARALLEL with a per-call timeout and merge
 * their readings. This module OWNS the timeout/abort machinery that the /api/verify
 * route surfaces to the user as the "provider timeout" message.
 *
 * Reconciliation philosophy: agreement = confidence; disagreement = uncertainty. Fields where
 * providers agree get high confidence; fields where they disagree get LOW confidence so the
 * threshold gate routes them to human review. If one provider times out, we reconcile
 * from whatever returned rather than failing the whole verify — never block on a straggler.
 */
import type { ExtractedFields, FieldConfidence } from "@/domain";
import { similarity } from "@/compare";
import { FIELD_CATALOG, type ExtractedValueKey } from "./fieldCatalog";
import type { ImageInput, VisionProvider } from "./VisionProvider";

/** Per-call extraction timeout (~3s) — the mock/offline default; keeps tests fast and deterministic. */
export const DEFAULT_PER_CALL_TIMEOUT_MS = 3000;

/**
 * Per-call timeout for the real (network) providers — a straggler CAP, not the ~5s result budget.
 * A single Azure-vision call normally returns in ~1–4s; this only kills a genuine hang. With the
 * parallel reconciler a slow partner is abandoned, never blocking the verdict. Override per-deploy
 * with `VISION_TIMEOUT_MS`.
 */
export const REAL_PROVIDER_TIMEOUT_MS = 8000;

/** Confidence assigned to a field when providers DISAGREE — low, so it routes to review. */
export const DISAGREEMENT_CONFIDENCE = 0.3;

/**
 * Resolve the per-call timeout for a verify run. Precedence: a valid `VISION_TIMEOUT_MS` override;
 * else the real-provider cap (~8s) when any non-mock provider is active; else the mock default (~3s)
 * — which leaves the offline/test path and the existing reconcile tests unchanged.
 */
export function resolveTimeoutMs(
  providers: VisionProvider[],
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.VISION_TIMEOUT_MS?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return providers.some((p) => p.name !== "mock")
    ? REAL_PROVIDER_TIMEOUT_MS
    : DEFAULT_PER_CALL_TIMEOUT_MS;
}

function isTimeoutLike(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

/**
 * Run one provider's extract with a per-call timeout. Resolves with its result, or rejects with a
 * TimeoutError once `timeoutMs` elapses (also aborting the provider so it can cancel in-flight
 * work). The race guarantees the caller is never blocked even if a provider ignores the signal.
 */
export function extractWithTimeout(
  provider: VisionProvider,
  image: ImageInput,
  timeoutMs: number,
): Promise<ExtractedFields> {
  const controller = new AbortController();
  return new Promise<ExtractedFields>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(
        new DOMException(`Provider '${provider.name}' timed out after ${timeoutMs}ms`, "TimeoutError"),
      );
    }, timeoutMs);
    provider.extract(image, controller.signal).then(
      (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

// The merged value fields and their confidence channels are derived from the single field catalog,
// so a new extracted field is reconciled across front/back automatically (no silent omission here).
type ValueField = ExtractedValueKey;
const VALUE_FIELDS: ValueField[] = FIELD_CATALOG.map((d) => d.key);
/** The FieldConfidence key for a value field (alcoholContentText is keyed as `alcoholContent`). */
const CONF_KEY: Record<ValueField, keyof FieldConfidence> = Object.fromEntries(
  FIELD_CATALOG.map((d) => [d.key, d.confKey]),
) as Record<ValueField, keyof FieldConfidence>;

function norm(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Strip case + every non-alphanumeric, so "750 mL" and "750ml" (or "ABC Co, MD" and "ABC Co MD")
 *  compare equal — formatting differences are not disagreements. */
function canonical(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Tolerance threshold above which two reads count as the SAME value, not a disagreement. */
const AGREEMENT_SIMILARITY = 0.9;

/**
 * Identity fields where one read is often a SHORTER form of the other across front/back labels
 * (e.g. brand "OLD TOM" on the front vs producer "Old Tom Distillery" on the back). For these we
 * treat containment as agreement and keep the more complete value, rather than down-weighting to review.
 */
const IDENTITY_FIELDS = new Set<ValueField>(["brand", "name", "address"]);

/** Whether one canonical string contains the other (and the shorter is substantial, >= 3 chars). */
function isContainment(a: string, b: string): boolean {
  const ca = canonical(a);
  const cb = canonical(b);
  if (ca === "" || cb === "") return false;
  const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  return shorter.length >= 3 && longer.includes(shorter);
}

/**
 * Whether two provider reads of the same field should be treated as AGREEMENT. Exact-after-normalization
 * agrees; so does a punctuation/spacing-only difference ("750 mL" vs "750ml", "ABC Co, Frederick MD" vs
 * "ABC Co Frederick MD"), a containment case (one read is a more complete version of the other, e.g.
 * "OLD TOM" ⊂ "OLD TOM DISTILLERY"), or a high normalized-similarity read (a one-character OCR slip).
 * This keeps the ensemble/front-back merge from over-routing benign noise to review while still
 * flagging genuine divergence.
 */
function valuesAgree(a: string, b: string): boolean {
  if (norm(a) === norm(b)) return true;
  const ca = canonical(a);
  if (ca !== "" && ca === canonical(b)) return true;
  if (isContainment(a, b)) return true;
  return similarity(norm(a), norm(b)) >= AGREEMENT_SIMILARITY;
}

/**
 * Merge two extractions field-by-field: agree -> max confidence; disagree -> low confidence
 * (review); only one provided a value -> use it as-is.
 */
export function mergeExtracted(a: ExtractedFields, b: ExtractedFields): ExtractedFields {
  const confidence: FieldConfidence = {};
  // The warning format flags must travel WITH the warning text: when only one image carries the
  // government warning (the usual front/back split), use THAT image's prefix flags — not the first
  // image's defaults, which would mislabel a clean back-label warning as "not all caps".
  const aHasWarning = a.warningText != null && a.warningText.trim() !== "";
  const bHasWarning = b.warningText != null && b.warningText.trim() !== "";
  const warnSrc: ExtractedFields =
    bHasWarning && !aHasWarning
      ? b
      : aHasWarning && bHasWarning
        ? (a.confidence.warningText ?? 0) >= (b.confidence.warningText ?? 0)
          ? a
          : b
        : a;
  // Only fall back to the OTHER image's bold flag when that image ALSO carries a warning. Otherwise a
  // no-warning front image reporting bold=false (for an absent warning) would corrupt the warning-bearing
  // back image's genuinely-undetectable (null) flag into a hard-fail false — falsely rejecting a clean
  // back-label warning (the most common front/back split).
  const otherSrc = warnSrc === a ? b : a;
  const otherHasWarning = otherSrc.warningText != null && otherSrc.warningText.trim() !== "";
  const out: ExtractedFields = {
    warningPrefixIsAllCaps: warnSrc.warningPrefixIsAllCaps,
    warningPrefixIsBold:
      warnSrc.warningPrefixIsBold !== null
        ? warnSrc.warningPrefixIsBold
        : otherHasWarning
          ? otherSrc.warningPrefixIsBold
          : null,
    confidence,
  };

  for (const f of VALUE_FIELDS) {
    const key = CONF_KEY[f];
    const va = a[f];
    const vb = b[f];
    const ca = a.confidence[key] ?? 0;
    const cb = b.confidence[key] ?? 0;
    // Treat empty string as ABSENT, not a value. This matters for front/back merges: a field that
    // lives only on the front (blank on the back) is a one-sided fill, NOT a disagreement to
    // down-weight. Only two genuinely-different non-empty reads count as a disagreement.
    const ha = va != null && va.trim() !== "";
    const hb = vb != null && vb.trim() !== "";

    if (ha && hb) {
      const agree = valuesAgree(va, vb);
      // For identity fields, an agreeing pair often differs only in completeness (front prints a
      // shortened brand/producer); keep the MORE COMPLETE value rather than the higher-confidence one.
      out[f] =
        agree && IDENTITY_FIELDS.has(f)
          ? canonical(va).length >= canonical(vb).length
            ? va
            : vb
          : ca >= cb
            ? va
            : vb;
      confidence[key] = agree
        ? Math.max(ca, cb) // agree (incl. punctuation/spacing/containment/typo tolerance) -> confident
        : Math.min(DISAGREEMENT_CONFIDENCE, Math.min(ca, cb)); // disagree -> review
    } else if (ha) {
      out[f] = va;
      confidence[key] = ca;
    } else if (hb) {
      out[f] = vb;
      confidence[key] = cb;
    }
  }
  return out;
}

/**
 * Run all providers in parallel (each with a per-call timeout) and reconcile whatever returned.
 * - 0 returned: if every failure was a timeout, throw a TimeoutError (surfaced by the re-upload path);
 *   otherwise rethrow the first real error.
 * - 1 returned: use it (a timed-out partner doesn't fail the verify).
 * - 2+ returned: merge field-by-field (agree/disagree).
 */
export async function reconcileExtract(
  providers: VisionProvider[],
  image: ImageInput,
  timeoutMs: number = DEFAULT_PER_CALL_TIMEOUT_MS,
): Promise<ExtractedFields> {
  if (providers.length === 0) throw new Error("No vision providers are configured.");

  const settled = await Promise.allSettled(
    providers.map((p) => extractWithTimeout(p, image, timeoutMs)),
  );
  const fulfilled = settled
    .filter((s): s is PromiseFulfilledResult<ExtractedFields> => s.status === "fulfilled")
    .map((s) => s.value);

  if (fulfilled.length === 0) {
    const reasons = settled.map((s) => (s.status === "rejected" ? (s.reason as unknown) : undefined));
    if (reasons.every((r) => isTimeoutLike(r))) {
      throw new DOMException("All vision providers timed out.", "TimeoutError");
    }
    const firstError = reasons.find((r): r is Error => r instanceof Error);
    throw firstError ?? new Error("All vision providers failed to extract.");
  }

  return fulfilled.reduce((acc, cur) => mergeExtracted(acc, cur));
}
