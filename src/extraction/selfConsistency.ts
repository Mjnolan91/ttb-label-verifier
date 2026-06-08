/**
 * selfConsistency.ts — multi-sample agreement as the confidence signal.
 *
 * Self-reported model confidence is poorly calibrated (overconfident); running the read N times and
 * measuring agreement is a better signal. `aggregateSamples` reduces N reads to one record whose
 * per-field confidence IS the fraction of samples that produced the (normalized) majority value.
 * A SINGLE sample is returned untouched, so the deterministic mock + offline eval are unaffected.
 */
import type { ExtractedFields, FieldConfidence } from "@/domain";
import { FIELD_CATALOG } from "./fieldCatalog";
import { normalizeText } from "@/compare";

type ValueKey = (typeof FIELD_CATALOG)[number]["key"];

/** The normalized-majority value among samples for one field, plus the agreement fraction. */
function vote(values: (string | undefined)[]): { value: string | undefined; agreement: number } {
  const counts = new Map<string, { raw: string | undefined; n: number }>();
  for (const v of values) {
    const key = normalizeText(v ?? "");
    const cur = counts.get(key) ?? { raw: v, n: 0 };
    cur.n += 1;
    counts.set(key, cur);
  }
  let best = { raw: values[0], n: 0 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return { value: best.raw, agreement: best.n / values.length };
}

function voteBool<T>(values: T[]): T {
  const counts = new Map<string, { raw: T; n: number }>();
  for (const v of values) {
    const k = String(v);
    const cur = counts.get(k) ?? { raw: v, n: 0 };
    cur.n += 1;
    counts.set(k, cur);
  }
  let best = { raw: values[0], n: 0 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return best.raw;
}

export function aggregateSamples(samples: ExtractedFields[]): ExtractedFields {
  if (samples.length === 0) throw new Error("aggregateSamples requires at least one sample.");
  if (samples.length === 1) return samples[0]; // preserve the provider's own confidence (mock-safe)

  const out = { ...samples[0] } as ExtractedFields;
  const confidence: FieldConfidence = { ...samples[0].confidence };
  for (const d of FIELD_CATALOG) {
    const key = d.key as ValueKey;
    const { value, agreement } = vote(samples.map((s) => (s as unknown as Record<string, string | undefined>)[key]));
    (out as unknown as Record<string, string | undefined>)[key] = value;
    confidence[d.confKey] = agreement;
  }
  out.confidence = confidence;
  out.warningPrefixIsAllCaps = voteBool(samples.map((s) => s.warningPrefixIsAllCaps));
  out.warningPrefixIsBold = voteBool(samples.map((s) => s.warningPrefixIsBold));
  return out;
}
