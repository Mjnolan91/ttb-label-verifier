import type { Ref } from "react";
import type { CompletenessResult, CompletenessElement, ElementStatus } from "@/compare";
import type { RequirementKey } from "@/domain";
import { StatusBadge } from "./StatusBadge";
import { TONE_TINT, TONE_ICON, COMPLETENESS_LABEL, type Tone } from "./status";
import { CLASS_DISPLAY_LABEL } from "./beverageClass";

/**
 * CompletenessView — the TTB completeness check: for the detected beverage type, every required label
 * element flagged present / missing / malformed / n-a (color + icon + text).
 *
 * It also reflects the reviewer's resolutions: when a person confirms a field on the comparison above,
 * the matching element here shows "CONFIRMED BY YOU" and a previously low-confidence "Needs review"
 * headline recomputes to "Complete"; flagging a field shows "FLAGGED BY YOU" and makes it incomplete.
 * So the supporting check stays in step with the human's decisions, not just the AI's first read.
 */

/** A human override of an element, mirrored from the comparison cards (keyed by RequirementKey). */
type ElementOverride = "ok" | "issue";

/** What we actually display per row: the AI's element status, or the human's override. */
type Display = ElementStatus | "confirmed" | "flagged";

const DISPLAY_TONE: Record<Display, Tone> = {
  present: "pass",
  missing: "fail",
  malformed: "fail",
  unverifiable: "neutral",
  confirmed: "pass",
  flagged: "fail",
};
const DISPLAY_LABEL: Record<Display, string> = {
  present: "PRESENT",
  missing: "MISSING",
  malformed: "WRONG FORMAT",
  unverifiable: "NOT APPLICABLE",
  confirmed: "CONFIRMED BY YOU",
  flagged: "FLAGGED BY YOU",
};
const OVERALL_TONE: Record<CompletenessResult["overall"], Tone> = {
  complete: "pass",
  incomplete: "fail",
  review: "review",
};
const NEXT_STEP: Record<CompletenessResult["overall"], string> = {
  complete: "Every element TTB requires for this beverage type was found on the label.",
  incomplete:
    "One or more required items are missing or in the wrong format. Check the rows marked MISSING or WRONG FORMAT below before approving.",
  review:
    "Some required items couldn't be confirmed from the image. Open the label and check the highlighted rows below, or confirm them on the comparison above.",
};

function displayOf(el: CompletenessElement, override: ElementOverride | undefined): Display {
  if (override === "ok") return "confirmed";
  if (override === "issue") return "flagged";
  return el.status;
}

export function CompletenessView({
  completeness,
  overrides,
  headingRef,
}: {
  completeness: CompletenessResult;
  /** Per-element human decisions, mirrored from the comparison cards. */
  overrides?: Partial<Record<RequirementKey, ElementOverride>>;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  // Recompute the headline ONLY when the human has acted (else use the AI's computed overall, so the
  // pure check and its tests are untouched). A flagged/missing/malformed element -> incomplete; a
  // still-unconfirmed low-confidence read -> review; otherwise complete.
  const hasOverrides = overrides != null && Object.keys(overrides).length > 0;
  const overall: CompletenessResult["overall"] = hasOverrides
    ? (() => {
        const effs = completeness.elements.map((el) => ({ el, d: displayOf(el, overrides?.[el.key]) }));
        if (effs.some(({ d }) => d === "missing" || d === "malformed" || d === "flagged")) return "incomplete";
        if (effs.some(({ el, d }) => d === "present" && el.lowConfidence)) return "review";
        return "complete";
      })()
    : completeness.overall;

  const tone = OVERALL_TONE[overall];
  const OverallIcon = TONE_ICON[tone];
  return (
    <section aria-label="TTB completeness check" className="mt-6 flex flex-col gap-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      >
        TTB completeness check
      </h2>

      <div className={`flex items-center gap-4 rounded-card border-l-8 p-5 shadow-card ${TONE_TINT[tone]}`}>
        {OverallIcon && <OverallIcon className="h-9 w-9 shrink-0" />}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
            {CLASS_DISPLAY_LABEL[completeness.beverageClass]}
          </p>
          <p className="text-2xl font-bold">{COMPLETENESS_LABEL[overall]}</p>
          <p className="mt-1 text-sm">{NEXT_STEP[overall]}</p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {completeness.elements.map((el) => {
          const display = displayOf(el, overrides?.[el.key]);
          const elTone = DISPLAY_TONE[display];
          const Icon = TONE_ICON[elTone];
          const detail =
            display === "confirmed"
              ? "You confirmed this is correct."
              : display === "flagged"
                ? "You flagged this as a problem."
                : el.detail;
          return (
            <li key={el.key} className={`flex items-start gap-3 rounded-lg border-l-4 p-3 ${TONE_TINT[elTone]}`}>
              {Icon ? (
                <Icon className="mt-0.5 h-5 w-5 shrink-0" />
              ) : (
                <span aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{el.label}</span>
                  {el.necessity === "conditional" && (
                    <span className="text-xs text-ink-muted">(conditional)</span>
                  )}
                  <StatusBadge tone={elTone} label={DISPLAY_LABEL[display]} className="ml-auto" />
                </div>
                <p className="mt-0.5 break-words text-sm">{detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
