import { IconPass, IconSpinner } from "./icons";

/**
 * PipelineSteps — a compact, always-visible spine that makes the ORDER OF OPERATIONS legible:
 * Upload → AI reads the label (with a confidence score) → Compare to the application → Verdict.
 *
 * This exists because the "AI read" is a separate, fallible stage, and when a verdict is driven by
 * that read's confidence the user needs a mental model for it — otherwise a confidence flag on the
 * read looks like a rejection of their match. Naming the read as its own step gives the per-field
 * "% read" chips and the calm "confirm the photo" copy an on-screen antecedent.
 *
 * Presentational only; the active stage is passed in. Rendered as an ordered list with aria-current
 * on the active step so the sequence is conveyed to assistive tech, not just by color.
 */

type Stage = "reading" | "awaiting" | "done";

const STEPS = ["Upload label", "AI reads label", "Compare to application", "Verdict"] as const;

function StepMarker({ state, n }: { state: "done" | "active" | "pending"; n: number }) {
  const base =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition";
  // The completion state is conveyed visually by the marker (filled+check / ring / muted number); pair
  // it with screen-reader text so the "done vs not-started" distinction isn't color/icon-only (WCAG 1.4.1).
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
    // The "AI reads label" step animates while a read is in flight; other active steps are a calm ring.
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

export function PipelineSteps({ stage }: { stage: Stage }) {
  // Index of the currently-active step: reading -> "AI reads", awaiting -> "Compare", done -> "Verdict".
  const activeIndex = stage === "reading" ? 1 : stage === "awaiting" ? 2 : 3;
  return (
    <ol aria-label="How this verification works, in order" className="flex items-start">
      {STEPS.map((label, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
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
              <StepMarker state={state} n={i + 1} />
              <span
                className={`h-0.5 flex-1 ${isLast ? "opacity-0" : i < activeIndex ? "bg-brand-500" : "bg-border"}`}
              />
            </div>
            <span
              className={`mt-1.5 px-1 text-xs leading-tight ${state === "pending" ? "text-ink-muted" : "font-medium text-ink"}`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
