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
 *      The cap is TIERED (2026-06-10, batch-distrust investigation): a SUPERMAJORITY dropout — the
 *      agreeing value cluster covers >= 75% of ALL samples and only the remainder dropped the field —
 *      caps at 0.65 instead of the hard 0.3. Both land in review (no auto-pass), but 0.65 sits inside
 *      the strong-model rescue band while 0.3 is deliberately outside it: the probability of one
 *      sample dropping a field GROWS with sample count, so the most common artifact of a wider vote
 *      was a correct field stamped permanently unrescuable. Genuine splits (sub-supermajority) and
 *      all numeric splits keep the hard 0.3 — cross-source conflicts stay with a human. Note the
 *      tier is INERT at the offline default width of 3 (a single dropout is 2/3 < 0.75; it first
 *      fires at width 4) — deliberate: narrow votes carry too little evidence to soften a conflict.
 *   2. ALCOHOL numeric cross-check. For the alcohol statement, if the samples disagree on the ABV
 *      magnitude while the proof is stable (or vice versa), we cap confidence into review rather than
 *      asserting a number that could drive a wrong tolerance verdict.
 */
import type { ExtractedFields, FieldConfidence } from "@/domain";
import { FIELD_CATALOG } from "./fieldCatalog";
import { FIELD_REVIEW_CONFIDENCE, isExtractionReadable, normalizeText, parseAlcoholText } from "@/compare";
import { DISAGREEMENT_CONFIDENCE, canonical, reconcileExtract, reconcileExtractJoint, valuesAgree } from "./reconcile";
import { resolveSelfConsistencyEscalation } from "./config";
import type { ExtractOptions, ImageInput, VisionProvider } from "./VisionProvider";

type ValueKey = (typeof FIELD_CATALOG)[number]["key"];

/** A presence-unstable field whose value cluster still covers this fraction of ALL samples is a
 *  dropout artifact, not a genuine split. */
export const SUPERMAJORITY_PRESENCE_FRACTION = 0.75;
/** The confidence for a supermajority dropout: review-gated (< 0.7) but rescue-eligible (> 0.3). */
export const SUPERMAJORITY_DROPOUT_CONFIDENCE = 0.65;

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
/**
 * The representative reading of one cluster: the most frequent normalized form wins; a tie goes to
 * the more COMPLETE raw value (longest canonical), mirroring the merge's keep-the-fuller-read rule.
 */
function representative(members: string[]): string {
  const counts = new Map<string, { raw: string; n: number }>();
  for (const m of members) {
    const key = normalizeText(m);
    const cur = counts.get(key) ?? { raw: m, n: 0 };
    cur.n += 1;
    counts.set(key, cur);
  }
  let best: { raw: string; n: number } | undefined;
  for (const c of counts.values()) {
    if (!best || c.n > best.n || (c.n === best.n && canonical(c.raw).length > canonical(best.raw).length)) {
      best = c;
    }
  }
  return (best as { raw: string }).raw;
}

function vote(values: (string | undefined)[]): {
  value: string | undefined;
  agreement: number;
  presenceStable: boolean;
  /** The surfaced value's cluster as a fraction of ALL samples (0 when no value is surfaced) — the
   *  supermajority-dropout test keys on this, never on the absent side's share. */
  valueFraction: number;
} {
  // CLUSTERED (semantic) voting: samples that agree under the SAME tolerant field-equivalence the
  // provider merge uses (valuesAgree: punctuation/diacritic noise, containment, a one-character
  // slip — but NEVER a numeric difference) count as one reading. Exact-key voting read "Gonçalves"
  // vs "Goncalves" as disagreement and diluted a correct field to 2/3 confidence — cosmetic
  // transcription variance is not evidence of a misread. Clusters anchor on their first member;
  // at N <= ~6 samples chain-drift is not a concern.
  const present = values.filter(isPresent) as string[];
  const absentCount = values.length - present.length;
  const clusters: string[][] = [];
  for (const v of present) {
    const home = clusters.find((c) => valuesAgree(c[0], v));
    if (home) home.push(v);
    else clusters.push([v]);
  }
  let bestCluster: string[] | undefined;
  for (const c of clusters) if (!bestCluster || c.length > bestCluster.length) bestCluster = c;
  const bestPresent = bestCluster?.length ?? 0;

  const presenceStable = absentCount === 0 || present.length === 0;
  // Absence wins only a strict majority over the best value cluster; a tie surfaces the VALUE (a
  // human can confirm a value; a silently-asserted absence they cannot). Either way an unstable
  // presence is capped to review by the caller.
  const absentWins = absentCount > bestPresent;
  const value = absentWins || !bestCluster ? undefined : representative(bestCluster);
  const agreement = (absentWins ? absentCount : bestPresent) / values.length;
  // When presence is unstable, still surface the best PRESENT reading (mirrors the old behavior of
  // preferring the majority among present samples).
  if (!presenceStable && bestCluster) {
    return {
      value: representative(bestCluster),
      agreement,
      presenceStable,
      valueFraction: bestPresent / values.length,
    };
  }
  return { value, agreement, presenceStable, valueFraction: value === undefined ? 0 : bestPresent / values.length };
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
    const { value, agreement, presenceStable, valueFraction } = vote(rawValues);
    (out as unknown as Record<string, string | undefined>)[key] = value;

    // Start from the raw agreement fraction, then DOWN-WEIGHT (never up) for the robustness guards.
    let conf = agreement;
    // (1) Unstable presence: a minority dropout/hallucination must not assert a confident value or
    // absence — route to review rather than trusting the majority. TIERED: a supermajority value
    // cluster (one-sample dropout) caps to the rescue-eligible 0.65; genuine splits keep the hard 0.3.
    if (!presenceStable) {
      const cap =
        valueFraction >= SUPERMAJORITY_PRESENCE_FRACTION
          ? SUPERMAJORITY_DROPOUT_CONFIDENCE
          : DISAGREEMENT_CONFIDENCE;
      conf = Math.min(conf, cap);
    }
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
  // Cross-image conflict reports UNION across samples (no majority vote): one sample seeing a panel
  // contradiction is uncertainty enough to route that field to a human — bias to review, never to a
  // silently-resolved conflict. (Per-image reads never set this; it is the joint read's signal.)
  const conflicts = [...new Set(samples.flatMap((s) => s.crossImageConflicts ?? []))];
  if (conflicts.length > 0) out.crossImageConflicts = conflicts;
  return out;
}

/**
 * Deterministically cap every field the model reported as a CROSS-IMAGE CONFLICT into the conflict
 * band (DISAGREEMENT_CONFIDENCE, 0.3): review-gated AND below the rescue band, because two label
 * panels printing different values is a physical discrepancy a third model read cannot arbitrate —
 * the same reasoning that keeps cross-source conflicts rescue-ineligible (see rescue.ts). The model
 * reports the contradiction; THIS code decides what it means. Mutates and returns `e`.
 */
export function applyCrossImageConflictCaps(e: ExtractedFields): ExtractedFields {
  for (const k of e.crossImageConflicts ?? []) {
    const cur = e.confidence[k];
    e.confidence[k] = Math.min(typeof cur === "number" ? cur : DISAGREEMENT_CONFIDENCE, DISAGREEMENT_CONFIDENCE);
  }
  return e;
}

/** One reconciled read — the unit self-consistency samples (per-image or joint, the caller picks). */
type ReconciledRead = (options?: ExtractOptions) => Promise<ExtractedFields>;

/** Draw `n` sampled reads in parallel; returns the ones that succeeded (possibly empty). */
async function drawSamples(
  read: ReconciledRead,
  n: number,
): Promise<{ reads: ExtractedFields[]; firstError: unknown }> {
  const settled = await Promise.allSettled(Array.from({ length: n }, () => read({ sample: true })));
  const reads = settled
    .filter((s): s is PromiseFulfilledResult<ExtractedFields> => s.status === "fulfilled")
    .map((s) => s.value);
  const rejected = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  return { reads, firstError: rejected?.reason };
}

/** The fields whose borderline confidence justifies paying for extra evidence: the always-compared
 *  application set plus the warning — the channels a verdict actually consumes. The long-tail
 *  optional fields (fanciful name, age statement, vintage...) flicker between samples on real
 *  labels (a hallucinated value in 1 of 3 reads caps them to 0.3 routinely); letting them trigger
 *  escalated nearly EVERY live read and doubled p50 latency (measured 2026-06-10: 8.1s vs 4.1s).
 *  Shared by the escalation lever here AND the strong-model rescue pass (rescue.ts). */
export const VERDICT_RELEVANT_FIELDS = [
  "brand",
  "classType",
  "alcoholContent",
  "netContents",
  "name",
  "address",
  "warningText",
] as const;

/** Whether a VERDICT-RELEVANT field sits in the borderline band: present-but-below the review
 *  gate. This is the "one noisy sample dragged a good read to 2/3" signature that more evidence
 *  can resolve; fields at exactly 0 or absent are not borderline (more samples won't conjure
 *  missing text), and long-tail fields never trigger (see ESCALATION_FIELDS). */
function hasBorderlineField(e: ExtractedFields): boolean {
  return VERDICT_RELEVANT_FIELDS.some((k) => {
    const c = e.confidence[k];
    return typeof c === "number" && c > 0 && c < FIELD_REVIEW_CONFIDENCE;
  });
}

/** Read the image `samples` times in PARALLEL (sampling mode) through the reconciler, then aggregate
 *  to agreement-based confidence. samples<=1 is a single normal read (preserves provider confidence).
 *  Partial failures are tolerated: aggregates the samples that succeed; throws only if all fail.
 *
 *  ADAPTIVE ESCALATION (sample-until-confident, bounded): when the aggregate is readable but some
 *  field landed in the borderline band (0 < confidence < the 0.7 review gate), ONE extra batch of
 *  up to SELF_CONSISTENCY_ESCALATION samples (default 2) is drawn and the vote re-runs over all
 *  reads. A single noisy sample out of 3 (2/3 = 0.67, just under the gate) becomes 4/5 = 0.8 when
 *  the extra reads agree — while a genuine split stays below the gate and still routes to review.
 *  Cost is bounded: at most one extra parallel batch, only on contested reads; the mock path
 *  (samples <= 1) never escalates, so the offline suite and eval stay deterministic. */
export async function selfConsistentExtract(
  providers: VisionProvider[],
  image: ImageInput,
  timeoutMs: number | undefined,
  samples: number,
): Promise<ExtractedFields> {
  return selfConsistentRead((options) => reconcileExtract(providers, image, timeoutMs, options), samples);
}

/** The JOINT-read twin of selfConsistentExtract: each sample is ONE request carrying ALL of the
 *  product's images (reconcileExtractJoint), so a product pays `samples` requests instead of
 *  `images x samples` — same N-sample agreement vote, escalation, and failure semantics. */
export async function selfConsistentExtractJoint(
  providers: VisionProvider[],
  images: ImageInput[],
  timeoutMs: number | undefined,
  samples: number,
): Promise<ExtractedFields> {
  return selfConsistentRead((options) => reconcileExtractJoint(providers, images, timeoutMs, options), samples);
}

async function selfConsistentRead(read: ReconciledRead, samples: number): Promise<ExtractedFields> {
  if (samples <= 1) return read();
  const base = await drawSamples(read, samples);
  if (base.reads.length === 0) {
    throw base.firstError ?? new Error("All self-consistency samples failed.");
  }
  let aggregated = aggregateSamples(base.reads);

  const escalation = resolveSelfConsistencyEscalation();
  if (escalation > 0 && isExtractionReadable(aggregated) && hasBorderlineField(aggregated)) {
    const extra = await drawSamples(read, escalation);
    if (extra.reads.length > 0) {
      aggregated = aggregateSamples([...base.reads, ...extra.reads]);
    }
  }
  return aggregated;
}
