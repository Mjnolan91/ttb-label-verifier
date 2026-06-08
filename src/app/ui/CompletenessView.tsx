import type { Ref } from "react";
import type { CompletenessResult, ElementStatus } from "@/compare";
import { StatusBadge } from "./StatusBadge";
import { TONE_TINT, TONE_ICON, COMPLETENESS_LABEL, type Tone } from "./status";
import { CLASS_DISPLAY_LABEL } from "./beverageClass";

/**
 * CompletenessView — the TTB completeness verdict: for the detected beverage type, every required
 * label element flagged present / missing / malformed / n-a (color + icon + text). The headline
 * verification of the extraction-first app.
 */

const STATUS_TONE: Record<ElementStatus, Tone> = {
  present: "pass",
  missing: "fail",
  malformed: "fail",
  unverifiable: "neutral",
};
const STATUS_LABEL: Record<ElementStatus, string> = {
  present: "PRESENT",
  missing: "MISSING",
  malformed: "WRONG FORMAT",
  unverifiable: "NOT APPLICABLE",
};
const OVERALL_TONE: Record<CompletenessResult["overall"], Tone> = {
  complete: "pass",
  incomplete: "fail",
  review: "review",
};
/** A plain "what do I do now" line under the completeness headline — this section is the headline
 *  result when no application values are entered, so it needs the same guidance ResultView gives. */
const NEXT_STEP: Record<CompletenessResult["overall"], string> = {
  complete: "Every element TTB requires for this beverage type was found on the label.",
  incomplete:
    "One or more required items are missing or in the wrong format — check the rows marked MISSING or WRONG FORMAT below before approving.",
  review:
    "Some required items couldn't be confirmed from the image — open the label and check the highlighted rows below.",
};

export function CompletenessView({
  completeness,
  headingRef,
}: {
  completeness: CompletenessResult;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const tone = OVERALL_TONE[completeness.overall];
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
          <p className="text-2xl font-bold">{COMPLETENESS_LABEL[completeness.overall]}</p>
          <p className="mt-1 text-sm">{NEXT_STEP[completeness.overall]}</p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {completeness.elements.map((el) => {
          const tone = STATUS_TONE[el.status];
          const Icon = TONE_ICON[tone];
          return (
            <li key={el.key} className={`flex items-start gap-3 rounded-lg border-l-4 p-3 ${TONE_TINT[tone]}`}>
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
                  <StatusBadge tone={tone} label={STATUS_LABEL[el.status]} className="ml-auto" />
                </div>
                <p className="mt-0.5 break-words text-sm">{el.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
