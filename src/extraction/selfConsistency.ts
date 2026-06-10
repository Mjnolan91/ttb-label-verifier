/**
 * selfConsistency.ts — multi-sample agreement as the confidence signal.
 *
 * Self-reported model confidence is poorly calibrated (overconfident); running the read N times and
 * measuring agreement is a better signal. `aggregateSamples` reduces N reads to one record whose
 * per-field confidence IS the fraction of samples that produced the (normalized) majority value.
 * A SINGLE sample is returned untouched, so the deterministic mock + offline eval are unaffected.
 *
 * Two robustness guards sit on top of the raw value vote, and only ever LOWER confidence (never
 * raise it) so they cannot manufacture a false approval:
 *   1. PRESENCE vs VALUE agreement. The value vote alone buckets `undefined`/`""` together with a
 *      real value, so a field present in only a MINORITY of samples (e.g. 2 absent, 1 valued) could
 *      surface a confident absence — a dropout read as a clean "field not on the label". We compute
 *      presence-agreement separately; when presence is UNSTABLE across samples (split present/absent)
 *      we cap the field's confidence into the review band rather than asserting the majority. When
 *      every sample AGREES on presence (all present, or all absent) the behavior is unchanged.
 *   2. ALCOHOL numeric cross-check. For the alcohol statement, if the samples disagree on the ABV
 *      magnitude while the proof is stable (or vice versa), we cap confidence into review rather than
 *      asserting a number that could drive a wrong tolerance verdict.
 */
import type { ExtractedFields, FieldConfidence } from "@/domain";
import { FIELD_CATALOG } from "./fieldCatalog";
import { normalizeText, parseAlcoholText } from "@/compare";
import { DISAGREEMENT_CONFIDENCE, reconcileExtract } from "./reconcile";
import type { ImageInput, VisionProvider } from "./VisionProvider";

type ValueKey = (typeof FIELD_CATALOG)[number]["key"];

/** A field value counts as PRESENT only when it is a non-empty, non-whitespace string. */
function isPresent(v: string | undefined): boolean {
  return v != null && v.trim() !== "";
}

/**
 * Vote on one field across samples, tracking PRESENCE separately from VALUE.
 *  - `value`/`agreement` — the normalized-majority value and the fraction of samples that produced it.
 *  - `presenceStable` — every sample agrees on whether the field is present (all present, or all absent).
 *    When it is UNSTABLE (split present/absent), the majority value/absence must NOT be asserted at high
 *    confidence: a minority dropout/hallucination can otherwise read as a confident clean absence.
 */
function vote(values: (string | undefined)[]): {
  value: string | undefined;
  agreement: number;
  presenceStable: boolean;
} {
  const counts = new Map<string, { raw: string | undefined; n: number }>();
  for (const v of values) {
    const key = normalizeText(v ?? "");
    const cur = counts.get(key) ?? { raw: v, n: 0 };
    cur.n += 1;
    counts.set(key, cur);
  }
  let best = { raw: values[0], n: 0 };
  for (const c of counts.values()) if (c.n > best.n) best = c;

  const presentCount = values.filter(isPresent).length;
  const presenceStable = presentCount === 0 || presentCount === values.length;

  // When presence is unstable, prefer the majority value AMONG THE PRESENT samples (so we surface the
  // value a human can confirm, rather than asserting an absence the minority contradicts).
  let value = best.raw;
  if (!presenceStable) {
    const presentValues = values.filter(isPresent);
    const v = vote(presentValues);
    value = v.value;
  }
  return { value, agreement: best.n / values.length, presenceStable };
}

/**
 * Majority vote over the tri-state warning flags. A TIE asserts nothing (null): a false flag
 * hard-fails the caps/bold check, and on a tie the "winner" would just be whichever sample happened
 * to sit first in the array — an accident of scheduling, not evidence. Ties (including a 1/1/1
 * true/false/null split) fall to null so the verdict surfaces "could not verify" for a human
 * instead of an order-dependent pass/fail. `undefined` folds into null (both mean "couldn't tell").
 */
function voteBool(values: (boolean | null | undefined)[]): boolean | null {
  const counts = new Map<string, { raw: boolean | null; n: number }>();
  for (const v of values) {
    const raw = v ?? null;
    const k = String(raw);
    const cur = counts.get(k) ?? { raw, n: 0 };
    cur.n += 1;
    counts.set(k, cur);
  }
  let best: { raw: boolean | null; n: number } | undefined;
  let tied = false;
  for (const c of counts.values()) {
    if (!best || c.n > best.n) {
      best = c;
      tied = false;
    } else if (c.n === best.n) {
      tied = true;
    }
  }
  return tied || !best ? null : best.raw;
}

/**
 * For the alcohol field, whether the samples agree on the NUMERIC content (ABV and proof magnitudes),
 * not just the raw text. Disagreement on the ABV magnitude while the proof is stable (or vice versa)
 * is a dangerous split — it can drive a wrong tolerance verdict — so it caps confidence to review even
 * if the raw-text vote happened to reach a majority. Only PRESENT samples are considered; a missing
 * proof on some samples is not a magnitude disagreement (labels routinely omit proof).
 */
function alcoholNumbersStable(values: (string | undefined)[]): boolean {
  const present = values.filter(isPresent);
  if (present.length <= 1) return true;
  const abvs = new Set<number>();
  const proofs = new Set<number>();
  for (const v of present) {
    const { abv, proof } = parseAlcoholText(v);
    if (abv !== undefined) abvs.add(abv);
    if (proof !== undefined) proofs.add(proof);
  }
  // More than one distinct ABV OR more than one distinct proof across the samples = an unstable
  // magnitude. (An absent number on some samples doesn't add to the set, so it isn't a disagreement.)
  return abvs.size <= 1 && proofs.size <= 1;
}

export function aggregateSamples(samples: ExtractedFields[]): ExtractedFields {
  if (samples.length === 0) throw new Error("aggregateSamples requires at least one sample.");
  if (samples.length === 1) return samples[0]; // preserve the provider's own confidence (mock-safe)

  const out = { ...samples[0] } as ExtractedFields;
  const confidence: FieldConfidence = { ...samples[0].confidence };
  for (const d of FIELD_CATALOG) {
    const key = d.key as ValueKey;
    const rawValues = samples.map((s) => (s as unknown as Record<string, string | undefined>)[key]);
    const { value, agreement, presenceStable } = vote(rawValues);
    (out as unknown as Record<string, string | undefined>)[key] = value;

    // Start from the raw agreement fraction, then DOWN-WEIGHT (never up) for the robustness guards.
    let conf = agreement;
    // (1) Unstable presence: a minority dropout/hallucination must not assert a confident value or
    // absence — route to review rather than trusting the majority.
    if (!presenceStable) conf = Math.min(conf, DISAGREEMENT_CONFIDENCE);
    // (2) Alcohol magnitude split: disagreeing ABV/proof numbers must not drive a tolerance verdict.
    if (d.key === "alcoholContentText" && !alcoholNumbersStable(rawValues)) {
      conf = Math.min(conf, DISAGREEMENT_CONFIDENCE);
    }
    confidence[d.confKey] = conf;
  }
  out.confidence = confidence;
  out.warningPrefixIsAllCaps = voteBool(samples.map((s) => s.warningPrefixIsAllCaps));
  out.warningPrefixIsBold = voteBool(samples.map((s) => s.warningPrefixIsBold));
  out.warningRemainderIsBold = voteBool(samples.map((s) => s.warningRemainderIsBold));
  out.warningIsReadilyLegible = voteBool(samples.map((s) => s.warningIsReadilyLegible));
  return out;
}

/** Read the image `samples` times in PARALLEL (sampling mode) through the reconciler, then aggregate
 *  to agreement-based confidence. samples<=1 is a single normal read (preserves provider confidence).
 *  Partial failures are tolerated: aggregates the samples that succeed; throws only if all fail. */
export async function selfConsistentExtract(
  providers: VisionProvider[],
  image: ImageInput,
  timeoutMs: number | undefined,
  samples: number,
): Promise<ExtractedFields> {
  if (samples <= 1) return reconcileExtract(providers, image, timeoutMs);
  const settled = await Promise.allSettled(
    Array.from({ length: samples }, () => reconcileExtract(providers, image, timeoutMs, { sample: true })),
  );
  const reads = settled
    .filter((s): s is PromiseFulfilledResult<ExtractedFields> => s.status === "fulfilled")
    .map((s) => s.value);
  if (reads.length === 0) {
    const rejected = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    throw rejected ? rejected.reason : new Error("All self-consistency samples failed.");
  }
  return aggregateSamples(reads);
}
