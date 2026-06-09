/**
 * labelReview.ts — the SINGLE derivation of a per-label human-in-the-loop review, shared by the single
 * screen (VerifyForm) and the batch worklist (BatchVerify). Given the combined verdict for one label and
 * the reviewer's per-field overrides, it computes everything the review UI needs: the effective headline
 * (after overrides), whether completeness is gating it, the completeness-row overrides, the per-card
 * concerns (a hard TTB problem on a field whose value matched), and the reviewer notes that seed the
 * applicant email. Pure and deterministic — so it's unit-tested once and both screens stay in lockstep.
 */
import { overallVerdict, worstVerdict, resolveCompletenessOverall } from "@/compare";
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
 *  reviewer's confirm/flag on a card mirrors onto the supporting completeness row. */
export const FIELD_TO_REQUIREMENT: Record<VerifyFieldKey, RequirementKey> = {
  brand: "brand",
  classType: "classType",
  alcohol: "alcoholContent",
  netContents: "netContents",
  name: "name",
  address: "address",
  countryOfOrigin: "countryOfOrigin",
  warning: "governmentWarning",
};

/** The inverse: a completeness element -> the comparison card a reviewer resolves it on, so a TTB problem
 *  on a field whose VALUE matched still surfaces a confirm/flag control (it can't get stranded in the
 *  collapsed completeness panel with no way to clear the gated verdict). */
export const REQUIREMENT_TO_FIELD: Partial<Record<RequirementKey, VerifyFieldKey>> = Object.fromEntries(
  (Object.entries(FIELD_TO_REQUIREMENT) as [VerifyFieldKey, RequirementKey][]).map(([f, r]) => [r, f]),
);

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
    if (v) completenessOverrides[FIELD_TO_REQUIREMENT[key]] = v;
  }

  const effStatusOf = (f: VerifyField) => {
    const o = fieldOverrides[f.key];
    return o === "ok" ? "pass" : o === "issue" ? "fail" : f.status;
  };

  const effectiveComparison: CombinedVerdict["overall"] = combined?.verify
    ? overallVerdict(combined.verify.fields.map(effStatusOf))
    : null;
  const completenessGate =
    combined && resolveCompletenessOverall(combined.completeness, completenessOverrides) === "incomplete"
      ? "review"
      : "approve";
  const effectiveOverall: CombinedVerdict["overall"] = effectiveComparison
    ? worstVerdict(effectiveComparison, completenessGate)
    : (combined?.overall ?? null);
  const effectiveGatedByCompleteness = Boolean(effectiveComparison) && effectiveOverall !== effectiveComparison;

  const completenessConcerns: Partial<Record<VerifyFieldKey, string>> = {};
  if (combined?.verify) {
    for (const el of combined.completeness.elements) {
      if (el.status !== "missing" && el.status !== "malformed") continue;
      const fk = REQUIREMENT_TO_FIELD[el.key];
      if (fk) completenessConcerns[fk] = el.detail;
    }
  }

  // The reviewer's per-field note (when they left one) is their own words and takes precedence over the
  // generic reason, so it reaches the applicant verbatim.
  const reviewedFields = combined?.verify?.fields ?? [];
  const rejectNotes = reviewedFields
    .filter((f) => effStatusOf(f) !== "pass")
    .map((f) => {
      const note = fieldNotes[f.key]?.trim();
      if (note) return `  - ${f.label}: ${note}`;
      return fieldOverrides[f.key] === "issue"
        ? `  - ${f.label}: flagged by the reviewer as a problem.`
        : `  - ${f.label}: ${f.reason}`;
    })
    .join("\n");
  const approveNotes = reviewedFields
    .filter((f) => fieldOverrides[f.key] === "ok")
    .map((f) => {
      const note = fieldNotes[f.key]?.trim();
      return note
        ? `  - ${f.label}: confirmed correct. ${note}`
        : `  - ${f.label}: confirmed correct on review of the label.`;
    })
    .join("\n");

  return {
    effectiveOverall,
    effectiveGatedByCompleteness,
    completenessOverrides,
    completenessConcerns,
    approveNotes,
    rejectNotes,
  };
}
