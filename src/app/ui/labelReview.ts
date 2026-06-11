/**
 * labelReview.ts — the SINGLE derivation of a per-label human-in-the-loop review, shared by the single
 * screen (VerifyForm) and the batch worklist (BatchVerify). Given the combined verdict for one label and
 * the reviewer's per-field overrides, it computes everything the review UI needs: the effective headline
 * (after overrides), whether completeness is gating it, the completeness-row overrides, the per-card
 * concerns (a hard TTB problem on a field whose value matched), and the reviewer notes that seed the
 * applicant email. Pure and deterministic — so it's unit-tested once and both screens stay in lockstep.
 */
import { COMPLETENESS_VERDICT, overallVerdict, worstVerdict, resolveCompletenessOverall } from "@/compare";
import type { CombinedVerdict, VerifyField, VerifyFieldKey } from "@/compare";
import type { RequirementKey } from "@/domain";
import type { FieldOverride } from "./ResultView";

/** A reviewer's per-field decisions over the AI verdict, keyed by comparison field. */
export type FieldOverrides = Partial<Record<VerifyFieldKey, FieldOverride>>;

/** A reviewer's free-text note left with a per-field decision (why it's flagged / what was confirmed),
 *  keyed by comparison field. Surfaced on the card and woven into the applicant-email notes. */
export type FieldNotes = Partial<Record<VerifyFieldKey, string>>;

/** The terminal decision a reviewer records for a label: approve, or reject / send back. */
export type ReviewDecision = "approve" | "reject";

/** A comparison field (VerifyFieldKey) -> the completeness element (RequirementKey) it stands for, so a
 *  reviewer's confirm/flag on a card mirrors onto the supporting completeness row. Partial: a comparison
 *  field with no completeness counterpart (e.g. `fancifulName`) is intentionally omitted. */
export const FIELD_TO_REQUIREMENT: Partial<Record<VerifyFieldKey, RequirementKey>> = {
  brand: "brand",
  classType: "classType",
  alcohol: "alcoholContent",
  netContents: "netContents",
  name: "name",
  address: "address",
  countryOfOrigin: "countryOfOrigin",
  statementOfComposition: "statementOfComposition",
  warning: "governmentWarning",
};

/** The inverse: a completeness element -> the comparison card a reviewer resolves it on, so a TTB problem
 *  on a field whose VALUE matched still surfaces a confirm/flag control (it can't get stranded in the
 *  collapsed completeness panel with no way to clear the gated verdict). */
export const REQUIREMENT_TO_FIELD: Partial<Record<RequirementKey, VerifyFieldKey>> = Object.fromEntries(
  (Object.entries(FIELD_TO_REQUIREMENT) as [VerifyFieldKey, RequirementKey][]).map(([f, r]) => [r, f]),
);


/**
 * Cap a derived verdict at review when one of the product's images dropped out of the read. The
 * unread image could contradict anything the surviving images showed, so an approve on partial
 * evidence is the false-approval class this project refuses to ship. Reject is never relaxed (the
 * surviving evidence already shows a violation; more images cannot un-violate it), and the
 * reviewer's explicitly RECORDED decision is theirs — this caps only the derived headline. Shared
 * by the single screen, the batch row/triage derivation, and the drawer, so they cannot disagree.
 */
export function capVerdictForPartialRead<T extends CombinedVerdict["overall"] | null | undefined>(
  verdict: T,
  partialRead: boolean,
): T | "review" {
  return partialRead && verdict === "approve" ? "review" : verdict;
}

export interface LabelReviewState {
  /** Headline verdict after the reviewer's overrides (null when no application values were supplied). */
  effectiveOverall: CombinedVerdict["overall"];
  /** True when the comparison alone would be more lenient but completeness held the verdict back. */
  effectiveGatedByCompleteness: boolean;
  /** The overrides keyed for the completeness rows, so the supporting check tracks the human's calls. */
  completenessOverrides: Partial<Record<RequirementKey, FieldOverride>>;
  /** A hard TTB completeness problem per field (missing / wrong format) even though the value matched. */
  completenessConcerns: Partial<Record<VerifyFieldKey, string>>;
  /** Reviewer notes seeded into the applicant email for each decision (drawn from the tool's status). */
  approveNotes: string;
  rejectNotes: string;
}

/** Toggle a single field override immutably (clears it when the same value is re-applied). */
export function toggleOverride(
  prev: FieldOverrides,
  key: VerifyFieldKey,
  value: FieldOverride | undefined,
): FieldOverrides {
  const next = { ...prev };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** Set (or clear, when blank) a single field's reviewer note immutably. */
export function setFieldNote(prev: FieldNotes, key: VerifyFieldKey, text: string): FieldNotes {
  const next = { ...prev };
  if (text.trim() === "") delete next[key];
  else next[key] = text;
  return next;
}

/**
 * Derive the full review state from one label's combined verdict + the reviewer's overrides. The
 * completeness GATE is recomputed from the same overrides (resolveCompletenessOverall), so confirming a
 * flagged field clears the gate and the verdict settles on Approve/Reject instead of being stranded on
 * "Needs review".
 */
export function deriveLabelReview(
  combined: CombinedVerdict | null,
  fieldOverrides: FieldOverrides,
  fieldNotes: FieldNotes = {},
): LabelReviewState {
  const completenessOverrides: Partial<Record<RequirementKey, FieldOverride>> = {};
  for (const key of Object.keys(fieldOverrides) as VerifyFieldKey[]) {
    const v = fieldOverrides[key];
    const req = FIELD_TO_REQUIREMENT[key];
    if (v && req) completenessOverrides[req] = v;
  }

  const effStatusOf = (f: VerifyField) => {
    const o = fieldOverrides[f.key];
    return o === "ok" ? "pass" : o === "issue" ? "fail" : f.status;
  };

  const effectiveComparison: CombinedVerdict["overall"] = combined?.verify
    ? overallVerdict(combined.verify.fields.map(effStatusOf))
    : null;
  // The gate maps the override-resolved completeness through THE SAME table combinedVerdict uses
  // (COMPLETENESS_VERDICT), so this derivation can never be more lenient than the raw combine. It
  // previously gated on "incomplete" only, which silently RELEASED the hold when a mandatory
  // element was merely present at LOW confidence ("review") — and an element the application does
  // not claim is never compared, so nothing else held it: a clean comparison then badged Approve
  // over an unvouched-for element (adversarial review, 2026-06-11: the batch second look's 0.65
  // recoveries widened this, but any 0.65 presence-instability read could trigger it). Confirming
  // the element ("ok", on the card or in the drawer) still clears the gate:
  // resolveCompletenessOverall excludes confirmed elements from both checks.
  const completenessGate = combined
    ? COMPLETENESS_VERDICT[resolveCompletenessOverall(combined.completeness, completenessOverrides)]
    : "approve";
  const effectiveOverall: CombinedVerdict["overall"] = effectiveComparison
    ? worstVerdict(effectiveComparison, completenessGate)
    : (combined?.overall ?? null);
  const effectiveGatedByCompleteness = Boolean(effectiveComparison) && effectiveOverall !== effectiveComparison;

  // Concerns are computed for EVERY combined verdict, comparison or not: a completeness-only row
  // (batch with no application CSV) must still surface its missing/malformed elements as resolvable
  // cards — this was previously gated on `verify`, which left the no-CSV drawer reviewable in name
  // only (controls existed nowhere, so flagged labels were stranded).
  const completenessConcerns: Partial<Record<VerifyFieldKey, string>> = {};
  if (combined) {
    for (const el of combined.completeness.elements) {
      if (el.status !== "missing" && el.status !== "malformed") continue;
      const fk = REQUIREMENT_TO_FIELD[el.key];
      if (fk) completenessConcerns[fk] = el.detail;
    }
  }

  // The reviewer's per-field note (when they left one) is their own words and takes precedence over the
  // generic reason, so it reaches the applicant verbatim.
  const reviewedFields = combined?.verify?.fields ?? [];
  // For a completeness-only review (no comparison), the email notes are seeded from the flagged
  // ELEMENTS instead, so a no-CSV send-back still names what is missing/malformed.
  const concernLines = (Object.keys(completenessConcerns) as VerifyFieldKey[]).map((fk) => ({
    key: fk,
    label: combined?.completeness.elements.find((el) => REQUIREMENT_TO_FIELD[el.key] === fk)?.label ?? fk,
    reason: completenessConcerns[fk] ?? "",
  }));
  const rejectNotes = (combined?.verify
    ? reviewedFields
        .filter((f) => effStatusOf(f) !== "pass")
        .map((f) => {
          const note = fieldNotes[f.key]?.trim();
          if (note) return `  - ${f.label}: ${note}`;
          return fieldOverrides[f.key] === "issue"
            ? `  - ${f.label}: flagged by the reviewer as a problem.`
            : `  - ${f.label}: ${f.reason}`;
        })
    : concernLines
        .filter((c) => fieldOverrides[c.key] !== "ok")
        .map((c) => {
          const note = fieldNotes[c.key]?.trim();
          return note ? `  - ${c.label}: ${note}` : `  - ${c.label}: ${c.reason}`;
        })
  ).join("\n");
  const approveNotes = (combined?.verify
    ? reviewedFields
        .filter((f) => fieldOverrides[f.key] === "ok")
        .map((f) => {
          const note = fieldNotes[f.key]?.trim();
          return note
            ? `  - ${f.label}: confirmed correct. ${note}`
            : `  - ${f.label}: confirmed correct on review of the label.`;
        })
    : concernLines
        .filter((c) => fieldOverrides[c.key] === "ok")
        .map((c) => {
          const note = fieldNotes[c.key]?.trim();
          return note
            ? `  - ${c.label}: confirmed present on the label. ${note}`
            : `  - ${c.label}: confirmed present on review of the label.`;
        })
  ).join("\n");

  return {
    effectiveOverall,
    effectiveGatedByCompleteness,
    completenessOverrides,
    completenessConcerns,
    approveNotes,
    rejectNotes,
  };
}
