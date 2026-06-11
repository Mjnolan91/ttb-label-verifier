import { IconPass, IconSpinner } from "./icons";
import { TONE_ICON, TONE_SOLID_VAR, VERDICT_LABEL, toneForStatus } from "./status";
import type { OverallVerdict } from "@/compare";

/**
 * PipelineSteps — the compact spine at the TOP of the verify card, and the screen's ONE step model:
 * its four stages mirror the section headings 1:1 (Label images / The application / Label vs.
 * application / Your decision), so the spine's numbers and the "Step N ·" eyebrows always agree.
 * The AI read is deliberately NOT a numbered stage: it is machine work inside stage 1 finishing
 * (the marker spins while reading; the status line under the upload slots narrates it). Stage 3
 * shows the traffic-light verdict disc once a verdict exists (the verdict IS the comparison's
 * output) and re-colors live as a reviewer resolves flags; stage 4 completes when a decision is
 * recorded. Presentational only; rendered as an ordered list with aria-current on the active step.
 */

type Stage = "idle" | "reading" | "awaiting" | "done";

const STEPS = ["Label images", "The application", "Label vs. application", "Your decision"] as const;

function StepMarker({ state, n, spinning }: { state: "done" | "active" | "pending"; n: number; spinning?: boolean }) {
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
    return (
      <span className={`${base} border-2 border-brand-600 bg-brand-50 text-brand-700`}>
        {sr}
        {spinning ? <IconSpinner className="h-4 w-4 motion-safe:animate-spin" /> : <span aria-hidden="true">{n}</span>}
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

/** Stage 3 once a verdict exists: a filled disc in the verdict's traffic-light color. */
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

export function PipelineSteps({
  stage,
  verdict,
  decided = false,
}: {
  stage: Stage;
  verdict?: OverallVerdict;
  decided?: boolean;
}) {
  // Index of the currently-active step. idle AND reading sit on step 1 (the read is stage 1
  // finishing, not a step of its own); awaiting -> step 2; a verdict -> step 4 until decided.
  const activeIndex = stage === "awaiting" ? 1 : stage === "done" ? (decided ? 4 : 3) : 0;
  return (
    <ol aria-label="How this verification works, in order" className="flex items-start">
      {STEPS.map((label, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
        // The comparison step carries the verdict disc instead of a plain check once a verdict exists.
        const showVerdict = i === 2 && stage === "done" && verdict !== undefined;
        const isFirst = i === 0;
        const isLast = i === STEPS.length - 1;
        return (
          <li
            key={label}
            className="flex flex-1 flex-col items-center text-center"
            aria-current={state === "active" ? "step" : undefined}
          >
            <div className="flex w-full items-center">
              <span
                className={`h-0.5 flex-1 ${isFirst ? "opacity-0" : i <= activeIndex ? "bg-brand-500" : "bg-border"}`}
              />
              {showVerdict ? (
                <VerdictMarker verdict={verdict} />
              ) : (
                <StepMarker state={state} n={i + 1} spinning={i === 0 && stage === "reading"} />
              )}
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
