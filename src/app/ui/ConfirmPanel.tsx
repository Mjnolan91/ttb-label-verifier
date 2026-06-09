import { useId, type Ref } from "react";
import type { ConfirmVerdict, ClassChoice } from "@/compare";
import type { RequirementKey } from "@/domain";
import { ConfirmFieldRow } from "./ConfirmFieldRow";
import { TONE_TINT, TONE_ICON, VERDICT_LABEL, toneForStatus } from "./status";
import { CLASS_CHOICES, CLASS_CHOICE_LABEL, coarseClassOf } from "./beverageClass";

const NEXT_STEP: Record<ConfirmVerdict["overall"], string> = {
  approve: "Every required field is confirmed and matches — this label can be approved.",
  review: "Some fields need a person's eyes — confirm or correct the highlighted ones below.",
  reject: "A required check failed — review the items marked “No match” before sending this back.",
};

/**
 * ConfirmPanel — the confirm-to-approve hybrid. The AI has pre-filled every field TTB requires for
 * the resolved beverage type; the agent confirms (Tab/✓) or corrects each. Flagged fields are hoisted
 * into a "Needs your check" group and block the verdict from resolving to Approve until handled; the
 * rest sit in a compact, pre-confirmed group. Verify-first: the headline outcome leads.
 */
export function ConfirmPanel({
  verdict,
  onAccept,
  onEdit,
  onMarkMissing,
  onClassChange,
  classOverridden = false,
  headingRef,
}: {
  verdict: ConfirmVerdict;
  onAccept: (key: RequirementKey) => void;
  onEdit: (key: RequirementKey, value: string) => void;
  onMarkMissing: (key: RequirementKey) => void;
  onClassChange: (choice: ClassChoice) => void;
  classOverridden?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const selectId = useId();
  const flagged = verdict.fields.filter((f) => f.needsConfirmation);
  const settled = verdict.fields.filter((f) => !f.needsConfirmation);
  const tone = verdict.awaitingConfirmation ? "review" : toneForStatus(verdict.overall);
  const OverallIcon = TONE_ICON[tone];

  return (
    <section aria-label="Confirm the label against the application" className="mt-6 flex flex-col gap-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      >
        Confirm the required fields
      </h2>

      <div
        className={`flex items-start gap-4 rounded-card border-l-8 p-5 shadow-card ${TONE_TINT[tone]}`}
      >
        {OverallIcon && <OverallIcon className="h-9 w-9 shrink-0" />}
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label htmlFor={selectId} className="text-xs font-semibold uppercase tracking-wide opacity-80">
              Beverage type
            </label>
            <select
              id={selectId}
              aria-label="Beverage type"
              value={coarseClassOf(verdict.beverageClass)}
              onChange={(e) => onClassChange(e.target.value as ClassChoice)}
              className="min-h-[44px] rounded-field border-2 border-border-strong bg-white px-2 py-1 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              {CLASS_CHOICES.map((c) => (
                <option key={c} value={c}>{CLASS_CHOICE_LABEL[c]}</option>
              ))}
            </select>
            <span className="text-xs opacity-70">
              {classOverridden ? "Changed by you" : "AI read this — change if wrong"}
            </span>
          </div>
          <p className="text-2xl font-bold">
            {verdict.awaitingConfirmation
              ? `${flagged.length} field${flagged.length === 1 ? "" : "s"} need your check`
              : VERDICT_LABEL[verdict.overall]}
          </p>
          <p className="mt-1 text-sm">
            {verdict.awaitingConfirmation
              ? "The AI filled in what it read. Confirm or correct each highlighted field below to finish."
              : NEXT_STEP[verdict.overall]}
          </p>
        </div>
      </div>

      {flagged.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Needs your check
          </h3>
          <ul className="flex flex-col gap-3">
            {flagged.map((f) => (
              <ConfirmFieldRow
                key={f.key}
                field={f}
                onAccept={() => onAccept(f.key)}
                onEdit={(v) => onEdit(f.key, v)}
                onMarkMissing={() => onMarkMissing(f.key)}
              />
            ))}
          </ul>
        </div>
      )}

      {settled.length > 0 && (
        <details
          className="rounded-card border border-border bg-surface-muted p-4"
          open={flagged.length === 0}
        >
          <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-ink">
            {flagged.length === 0 ? "All fields" : `Confirmed fields (${settled.length})`} &mdash; tap to review
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {settled.map((f) => (
              <ConfirmFieldRow
                key={f.key}
                field={f}
                onAccept={() => onAccept(f.key)}
                onEdit={(v) => onEdit(f.key, v)}
                onMarkMissing={() => onMarkMissing(f.key)}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
