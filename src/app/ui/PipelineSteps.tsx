import { IconPass, IconSpinner } from "./icons";
import { TONE_ICON, TONE_SOLID_VAR, VERDICT_LABEL, toneForStatus } from "./status";
import type { OverallVerdict } from "@/compare";

/**
 * PipelineSteps — a compact, always-visible spine that makes the ORDER OF OPERATIONS legible:
 * Upload → AI reads the label (with a confidence score) → Compare to the application → Verdict.
 *
 * The final "Verdict" step reflects the OUTCOME: once a verdict is reached it turns green (Approve),
 * amber (Needs review), or red (Reject) and shows the verdict word, so the spine mirrors the headline
 * (and re-colors live as a reviewer resolves flags). Presentational only; the active stage + verdict
 * are passed in. Rendered as an ordered list with aria-current on the active step.
 */

type Stage = "reading" | "awaiting" | "done";

const STEPS = ["Upload label", "AI reads label", "Compare to application", "Verdict"] as const;

function StepMarker({ state, n }: { state: "done" | "active" | "pending"; n: number }) {
  const base =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition";
  const srState =
    state === "done" ? "Completed: " : state === "active" ? "Current step: " : "Not started: ";
  const sr = <span className="sr-only">{srState}</span>;
  if (state === "done") {
    return (
      <span className={`${base} bg-brand-600 text-white`}>
        {sr}
        <IconPass className="h-4 w-4" />
      </span>
    );
  }
  if (state === "active") {
    return n === 2 ? (
      <span className={`${base} border-2 border-brand-600 bg-brand-50 text-brand-700`}>
        {sr}
        <IconSpinner className="h-4 w-4 motion-safe:animate-spin" />
      </span>
    ) : (
      <span className={`${base} border-2 border-brand-600 bg-brand-50 text-brand-700`}>
        {sr}
        <span aria-hidden="true">{n}</span>
      </span>
    );
  }
  return (
    <span className={`${base} border-2 border-border bg-surface text-ink-muted`}>
      {sr}
      <span aria-hidden="true">{n}</span>
    </span>
  );
}

/** The final step once a verdict exists: a filled disc in the verdict's traffic-light color. */
function VerdictMarker({ verdict }: { verdict: OverallVerdict }) {
  const tone = toneForStatus(verdict);
  const Icon = TONE_ICON[tone];
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
      style={{ backgroundColor: TONE_SOLID_VAR[tone] }}
    >
      <span className="sr-only">{VERDICT_LABEL[verdict]}: </span>
      {Icon && <Icon className="h-4 w-4" />}
    </span>
  );
}

export function PipelineSteps({ stage, verdict }: { stage: Stage; verdict?: OverallVerdict }) {
  // Index of the currently-active step: reading -> "AI reads", awaiting -> "Compare", done -> "Verdict".
  const activeIndex = stage === "reading" ? 1 : stage === "awaiting" ? 2 : 3;
  return (
    <ol aria-label="How this verification works, in order" className="flex items-start">
      {STEPS.map((label, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
        const isVerdictStep = i === STEPS.length - 1;
        const showVerdict = isVerdictStep && stage === "done" && verdict !== undefined;
        const isFirst = i === 0;
        const isLast = isVerdictStep;
        return (
          <li
            key={label}
            className="flex flex-1 flex-col items-center text-center"
            aria-current={state === "active" && !showVerdict ? "step" : undefined}
          >
            <div className="flex w-full items-center">
              <span
                className={`h-0.5 flex-1 ${isFirst ? "opacity-0" : i <= activeIndex ? "bg-brand-500" : "bg-border"}`}
              />
              {showVerdict ? <VerdictMarker verdict={verdict} /> : <StepMarker state={state} n={i + 1} />}
              <span
                className={`h-0.5 flex-1 ${isLast ? "opacity-0" : i < activeIndex ? "bg-brand-500" : "bg-border"}`}
              />
            </div>
            <span
              className={`mt-1.5 px-1 text-xs leading-tight ${state === "pending" && !showVerdict ? "text-ink-muted" : "font-medium text-ink"}`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
