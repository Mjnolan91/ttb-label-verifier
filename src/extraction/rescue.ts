/**
 * rescue.ts — the low-confidence RESCUE pass: a targeted second read on the provider's STRONGEST
 * model for exactly the fields the fast reads could not settle.
 *
 * Self-consistency tells us WHICH fields are contested (a borderline agreement fraction under the
 * 0.7 review gate); re-sampling the same fast model just re-rolls the same dice. This pass instead
 * asks the strong model (the one already trusted to judge the warning bold) to re-read ONLY the
 * contested fields, across ALL of the product's images in one call.
 *
 * Safety semantics are ASYMMETRIC, mirroring the project's thresholds philosophy:
 *  - The strong read AGREES with the fast majority (tolerant equivalence, `valuesAgree`): two
 *    independent models reading the same value is strong evidence — confidence rises to
 *    RESCUE_AGREED_CONFIDENCE (above the review gate), and the fuller form of the value is kept.
 *  - The strong read DISAGREES: the strong model's value becomes the field's value (the better
 *    suggestion for the human), but confidence is CAPPED at RESCUE_CONTESTED_CONFIDENCE — below
 *    the review gate, so a cross-model conflict still routes to a person. A rescue can therefore
 *    clear a false alarm, but it can never silently flip a genuine conflict to pass.
 *  - The strong read returns null (field not legible to it either): nothing changes.
 *
 * Only VERDICT-RELEVANT fields are eligible (the same seven the escalation lever uses): the
 * long-tail fields flicker on real labels and would fire the pass constantly for nothing the
 * verdict consumes. Absent fields are not eligible — the borderline band is about contested
 * PRESENT values; "the fast model saw nothing" is not a contest the strong model can referee
 * without inviting hallucinated finds.
 *
 * The mock provider does not implement `readFields`, so the offline suite and eval never rescue.
 */
import type { ExtractedFields } from "@/domain";
import { FIELD_REVIEW_CONFIDENCE } from "@/compare";
import { FIELD_CATALOG, type FieldDescriptor } from "./fieldCatalog";
import { DISAGREEMENT_CONFIDENCE, canonical, valuesAgree } from "./reconcile";
import { VERDICT_RELEVANT_FIELDS } from "./selfConsistency";
import type { ImageInput, VisionProvider } from "./VisionProvider";

/** Confidence after the strong model CONFIRMS the fast majority: cross-model agreement clears the
 *  0.7 review gate. Deliberately below 1.0 — it is two witnesses, not ground truth. */
export const RESCUE_AGREED_CONFIDENCE = 0.85;
/** Confidence cap when the strong model CONTRADICTS the fast majority: stays below the review gate
 *  so a cross-model conflict always reaches a human, now with the better value as the suggestion. */
export const RESCUE_CONTESTED_CONFIDENCE = 0.65;

export type RescueKey = (typeof VERDICT_RELEVANT_FIELDS)[number];

const byConfKey = new Map<string, FieldDescriptor>(FIELD_CATALOG.map((d) => [d.confKey as string, d]));

function valueOf(e: ExtractedFields, d: FieldDescriptor): string {
  return ((e as unknown as Record<string, string | undefined>)[d.key] ?? "").trim();
}

function setValue(e: ExtractedFields, d: FieldDescriptor, v: string): void {
  (e as unknown as Record<string, string | undefined>)[d.key] = v;
}

/**
 * The contested fields a rescue read can help with: verdict-relevant, value PRESENT, and the
 * agreement-based confidence in the borderline band ABOVE the conflict stamp — the same band the
 * escalation lever targets.
 *
 * Fields AT or BELOW DISAGREEMENT_CONFIDENCE are deliberately ineligible: that stamp marks a
 * cross-source CONFLICT (front label vs back label disagreeing on a value, or presence flapping
 * across samples), not mere uncertainty. Two label panels printing different numbers is a physical
 * discrepancy a third reading cannot arbitrate — a strong model voting for one panel would erase
 * the very signal that routes the conflict to a human (adversarial audit FP-3: mispaired batch
 * images "agree-boosted" past the gate).
 */
export function rescueEligibleKeys(e: ExtractedFields): RescueKey[] {
  return VERDICT_RELEVANT_FIELDS.filter((k) => {
    const c = e.confidence[k];
    const d = byConfKey.get(k);
    return (
      d !== undefined &&
      typeof c === "number" &&
      c > DISAGREEMENT_CONFIDENCE &&
      c < FIELD_REVIEW_CONFIDENCE &&
      valueOf(e, d) !== ""
    );
  });
}

/** The model-facing (raw schema) keys for a set of rescue keys, in catalog order. */
export function rescueRawKeys(keys: readonly RescueKey[]): string[] {
  return keys.map((k) => byConfKey.get(k)!.rawKey);
}

/**
 * Fold one strong read (keyed by RAW schema key, null = not legible) into the extraction,
 * per the agree-boost / disagree-cap semantics above. Mutates and returns `e`.
 */
export function applyRescue(
  e: ExtractedFields,
  keys: readonly RescueKey[],
  strong: Record<string, string | null>,
): ExtractedFields {
  for (const k of keys) {
    const d = byConfKey.get(k);
    if (!d) continue;
    const raw = strong[d.rawKey];
    const strongValue = typeof raw === "string" ? raw.trim() : "";
    if (strongValue === "") continue; // the strong model couldn't read it either: unchanged
    const cur = valueOf(e, d);
    if (cur === "") continue; // absent fields are never rescued (see module docs)
    if (valuesAgree(cur, strongValue)) {
      // Two independent models agree: keep the more complete form, clear the review gate.
      if (canonical(strongValue).length > canonical(cur).length) setValue(e, d, strongValue);
      e.confidence[k] = Math.max(e.confidence[k] ?? 0, RESCUE_AGREED_CONFIDENCE);
    } else {
      // Cross-model conflict: surface the strong model's read, but a human still decides. The
      // adoption is MARKED so no later pass can treat the same strong model agreeing with its own
      // words as independent evidence (the warning focus checks this before any agree-boost).
      setValue(e, d, strongValue);
      e.confidence[k] = RESCUE_CONTESTED_CONFIDENCE;
      e.strongReadAdopted = [...new Set([...(e.strongReadAdopted ?? []), k])];
    }
  }
  return e;
}

/** The dialect-neutral instruction both provider implementations send with the subset schema. */
export const RESCUE_PROMPT =
  "You are RE-READING specific fields of a U.S. TTB alcohol-beverage label that a faster reader " +
  "was unsure about. You may be shown several images of the SAME product (front/back/neck). For " +
  "each requested field, transcribe the text EXACTLY as printed wherever it appears on these " +
  "images, preserving capitalization, digits, punctuation, and symbols. Never guess, infer, " +
  "autocomplete, or correct. If a field is not legibly present on any image, return null for it. " +
  "Each field's allocation rule is in its schema description.";

/**
 * Run a provider's `readFields` bounded by the per-call straggler cap: on timeout the in-flight
 * request is aborted and the rescue degrades to null (no change) — the same pattern as the bold
 * judge. Never throws.
 */
export async function readFieldsBounded(
  provider: VisionProvider,
  images: ImageInput[],
  rawKeys: string[],
  timeoutMs: number,
): Promise<Record<string, string | null> | null> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    provider
      .readFields!(images, rawKeys, ctrl.signal)
      .catch(() => null)
      .finally(() => clearTimeout(timer)),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve(null);
      }, timeoutMs);
    }),
  ]);
}
