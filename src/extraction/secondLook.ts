/**
 * secondLook.ts — the batch worklist's DELAYED, TARGETED retry for incomplete reads.
 *
 * A read can settle cleanly (HTTP 200, readable, every retry policy satisfied) and still be missing
 * information that IS printed on the label: samples flap on field allocation, and a mandatory
 * element the merge never saw reports "missing" even though a fresh pair of eyes would find it.
 * The transport-level retry policy (pacing.ts) can't help — nothing failed. This module is the
 * complement: after a batch row settles INCOMPLETE, the client schedules ONE background re-read of
 * exactly the missing fields (the rescue's `readFields` machinery — a prompt built for those
 * entries, across ALL the product's images, on the provider's strong model), after a delay so the
 * second sample is decorrelated from whatever the first read hit.
 *
 * Safety semantics, mirroring the rescue / warning-focus precedents:
 *  - A recovered value lands at SECOND_LOOK_CONFIDENCE (0.65) — review-band, BELOW the 0.7 trust
 *    gate. The original N-sample read said "absent" and one focused read says "present"; that is
 *    presence instability (the same signal the tiered presence cap stamps), so the find is
 *    SURFACED for a person, never silently passed. The win is "caught and visible", not
 *    "auto-approved".
 *  - The merge FILLS EMPTY FIELDS ONLY. A value the original read DID produce is never overwritten
 *    (that would re-open the cross-read conflict channel the rescue's disagree-cap exists for),
 *    and a field held in `crossImageConflicts` is never touched (a deliberate review hold).
 *  - Warning FORMAT FLAGS are never set here: `readFields` returns transcripts, not typography
 *    judgments, so a recovered warning surfaces with its flags as the original read left them and
 *    compareWarning routes the unverifiable format to review — the statutory check never passes on
 *    a second look alone.
 *
 * The mock provider has no `readFields`, so offline/demo mode reports the pass as unsupported and
 * the row's note stays honest; the suite tests these semantics with stub providers.
 *
 * MODULE BOUNDARY: this file is ISOMORPHIC (pure catalog/merge logic + types) because the batch
 * CLIENT imports it directly — the @/extraction barrel reaches warningFocus.ts -> sharp, a
 * server-only native module that breaks a client bundle. The server half (the actual focused
 * read + its env switch) lives in secondLookServer.ts; keep anything that touches a provider,
 * process.env, or node-only code THERE.
 */
import type { ExtractedFields, FieldConfidence, RequirementKey } from "@/domain";
import type { CompletenessResult } from "@/compare";
import { FIELD_CATALOG, type FieldDescriptor } from "./fieldCatalog";

/** Confidence stamped on every second-look recovery: review-band on purpose (see module docs). */
export const SECOND_LOOK_CONFIDENCE = 0.65;

const byConfKey = new Map<string, FieldDescriptor>(FIELD_CATALOG.map((d) => [d.confKey as string, d]));

/**
 * Completeness element -> extraction field channel, for the elements a re-read could actually
 * recover. Elements with no extraction channel (none today) would simply never schedule.
 */
const REQUIREMENT_TO_CONF: Partial<Record<RequirementKey, keyof FieldConfidence>> = {
  brand: "brand",
  classType: "classType",
  alcoholContent: "alcoholContent",
  netContents: "netContents",
  name: "name",
  address: "address",
  governmentWarning: "warningText",
  countryOfOrigin: "countryOfOrigin",
  sulfiteDeclaration: "sulfiteDeclaration",
  ageStatement: "ageStatement",
  appellation: "appellation",
  statementOfComposition: "statementOfComposition",
};

/** The field channels a second look may read/fill — exactly the completeness-mapped set above. */
export const SECOND_LOOK_ALLOWED: ReadonlySet<keyof FieldConfidence> = new Set(
  Object.values(REQUIREMENT_TO_CONF),
);

export type SecondLookKey = keyof FieldConfidence;

/** The recovered values of one second look, keyed by field channel. */
export type SecondLookFindings = Partial<Record<SecondLookKey, { value: string; confidence: number }>>;

function valueOf(e: ExtractedFields, d: FieldDescriptor): string {
  return ((e as unknown as Record<string, string | undefined>)[d.key] ?? "").trim();
}

/**
 * The fields worth a second look for one settled row: every completeness element reported MISSING
 * (required for the beverage type but not found by the read), mapped to its extraction channel.
 * "Malformed" elements are deliberately excluded — there the text WAS read and fails a format rule;
 * re-reading what is actually printed cannot fix the print. Fields the extraction somehow carries a
 * value for, and fields held in `crossImageConflicts`, never qualify.
 */
export function secondLookKeysFor(
  extracted: ExtractedFields,
  completeness: CompletenessResult | undefined,
): SecondLookKey[] {
  if (!completeness) return [];
  const held = new Set(extracted.crossImageConflicts ?? []);
  const wanted = new Set<SecondLookKey>();
  for (const el of completeness.elements) {
    if (el.status !== "missing") continue;
    const conf = REQUIREMENT_TO_CONF[el.key];
    if (!conf || held.has(conf)) continue;
    const d = byConfKey.get(conf);
    if (!d || valueOf(extracted, d) !== "") continue;
    wanted.add(conf);
  }
  // Catalog order keeps the row note and the focused prompt stable.
  return FIELD_CATALOG.map((d) => d.confKey).filter((k) => wanted.has(k));
}

/** The catalog descriptors for a set of second-look keys, in the given order (server half's lookup). */
export function secondLookDescriptors(keys: readonly SecondLookKey[]): FieldDescriptor[] {
  return keys.map((k) => byConfKey.get(k)).filter((d): d is FieldDescriptor => d !== undefined);
}

/**
 * Fold one second look's findings into an extraction — IMMUTABLY (the batch row's state is React
 * state). Fills empty fields only; never overwrites a present value, never touches a
 * `crossImageConflicts` hold, never sets warning format flags. Returns the merged record plus the
 * channels actually filled (for the row's honest note).
 */
export function applySecondLook(
  extracted: ExtractedFields,
  findings: SecondLookFindings,
): { merged: ExtractedFields; filled: SecondLookKey[] } {
  const merged: ExtractedFields = { ...extracted, confidence: { ...extracted.confidence } };
  const held = new Set(extracted.crossImageConflicts ?? []);
  const filled: SecondLookKey[] = [];
  for (const [key, found] of Object.entries(findings) as [SecondLookKey, { value: string; confidence: number }][]) {
    const d = byConfKey.get(key);
    if (!d || !found || held.has(key)) continue;
    if (valueOf(merged, d) !== "") continue; // present values are never overwritten
    (merged as unknown as Record<string, string | undefined>)[d.key] = found.value;
    merged.confidence[key] = found.confidence;
    filled.push(key);
  }
  return { merged, filled };
}

/** Human label for a field channel (row notes), from the catalog. */
export function secondLookLabel(key: SecondLookKey): string {
  return byConfKey.get(key)?.label ?? key;
}
