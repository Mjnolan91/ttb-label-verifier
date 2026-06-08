/**
 * reconcile.ts — run multiple VisionProviders in PARALLEL with a per-call timeout and merge
 * their readings (US-010). This module OWNS the timeout/abort machinery that the /api/verify
 * route surfaces to the user as the "provider timeout" message (US-008).
 *
 * Reconciliation philosophy: agreement = confidence; disagreement = uncertainty. Fields where
 * providers agree get high confidence; fields where they disagree get LOW confidence so the
 * threshold gate (US-011) routes them to human review. If one provider times out, we reconcile
 * from whatever returned rather than failing the whole verify — never block on a straggler.
 */
import type { ExtractedFields, FieldConfidence } from "@/domain";
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

const VALUE_FIELDS = [
  "brand",
  "classType",
  "alcoholContentText",
  "netContents",
  "warningText",
  "nameAndAddress",
  "countryOfOrigin",
  "appellation",
  "vintage",
  "varietal",
  "sulfiteDeclaration",
  "ageStatement",
  "commodityStatement",
] as const;
type ValueField = (typeof VALUE_FIELDS)[number];

/** The FieldConfidence key for a value field (alcoholContentText is keyed as `alcoholContent`). */
const CONF_KEY: Record<ValueField, keyof FieldConfidence> = {
  brand: "brand",
  classType: "classType",
  alcoholContentText: "alcoholContent",
  netContents: "netContents",
  warningText: "warningText",
  nameAndAddress: "nameAndAddress",
  countryOfOrigin: "countryOfOrigin",
  appellation: "appellation",
  vintage: "vintage",
  varietal: "varietal",
  sulfiteDeclaration: "sulfiteDeclaration",
  ageStatement: "ageStatement",
  commodityStatement: "commodityStatement",
};

function norm(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Merge two extractions field-by-field: agree -> max confidence; disagree -> low confidence
 * (review); only one provided a value -> use it as-is.
 */
export function mergeExtracted(a: ExtractedFields, b: ExtractedFields): ExtractedFields {
  const confidence: FieldConfidence = {};
  const out: ExtractedFields = {
    warningPrefixIsAllCaps: a.warningPrefixIsAllCaps,
    // Prefer a DETECTED bold reading (true/false) over an undetectable one (null, e.g. OCR).
    warningPrefixIsBold:
      a.warningPrefixIsBold !== null ? a.warningPrefixIsBold : b.warningPrefixIsBold,
    confidence,
  };

  for (const f of VALUE_FIELDS) {
    const key = CONF_KEY[f];
    const va = a[f];
    const vb = b[f];
    const ca = a.confidence[key] ?? 0;
    const cb = b.confidence[key] ?? 0;

    if (va != null && vb != null) {
      out[f] = ca >= cb ? va : vb;
      confidence[key] =
        norm(va) === norm(vb)
          ? Math.max(ca, cb) // agree -> confident
          : Math.min(DISAGREEMENT_CONFIDENCE, Math.min(ca, cb)); // disagree -> review
    } else if (va != null) {
      out[f] = va;
      confidence[key] = ca;
    } else if (vb != null) {
      out[f] = vb;
      confidence[key] = cb;
    }
  }
  return out;
}

/**
 * Run all providers in parallel (each with a per-call timeout) and reconcile whatever returned.
 * - 0 returned: if every failure was a timeout, throw a TimeoutError (surfaced by US-008);
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
