import type { Ref } from "react";
import type { BeverageClass } from "@/domain";
import type { CompletenessResult, ElementStatus } from "@/compare";
import { StatusBadge } from "./StatusBadge";
import { TONE_TINT, TONE_ICON, type Tone } from "./status";

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
  malformed: "MALFORMED",
  unverifiable: "N/A",
};
const OVERALL: Record<CompletenessResult["overall"], { tone: Tone; label: string }> = {
  complete: { tone: "pass", label: "Complete" },
  incomplete: { tone: "fail", label: "Incomplete" },
  review: { tone: "review", label: "Needs review" },
};
const CLASS_LABEL: Record<BeverageClass, string> = {
  distilledSpirits: "Distilled spirits",
  wineUnder14: "Wine (≤14% ABV)",
  wineOver14: "Wine (>14% ABV)",
  maltBeverage: "Malt beverage",
  cider: "Cider",
  unknown: "Unknown beverage type",
};

export function CompletenessView({
  completeness,
  headingRef,
}: {
  completeness: CompletenessResult;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const o = OVERALL[completeness.overall];
  const OverallIcon = TONE_ICON[o.tone];
  return (
    <section role="status" aria-live="polite" aria-atomic="true" className="mt-6 flex flex-col gap-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      >
        TTB completeness check
      </h2>

      <div className={`flex items-center gap-4 rounded-card border-l-8 p-5 shadow-card ${TONE_TINT[o.tone]}`}>
        {OverallIcon && <OverallIcon className="h-9 w-9 shrink-0" />}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
            {CLASS_LABEL[completeness.beverageClass]}
          </p>
          <p className="text-2xl font-bold">{o.label}</p>
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
