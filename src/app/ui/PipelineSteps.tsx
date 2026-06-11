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
 * output) and re-colors live as a reviewer resolves flags; stage 4 tracks the DecisionPanel in two
 * visible states — an outlined tone disc the moment Approve/Reject is CHOSEN, a solid tone disc
 * once the decision is RECORDED — so every decision click moves the spine (a record-only spine
 * read as "the timeline never updates"). Presentational only; rendered as an ordered list with
 * aria-current on the active step. PipelineProgressPill (below) is the same model condensed into
 * the floating chip the verify screen pins top-left while the spine is scrolled out of view.
 */

type Stage = "idle" | "reading" | "awaiting" | "done";
export type DecisionChoice = "approve" | "reject";

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

const DECISION_LABEL: Record<DecisionChoice, string> = {
  approve: "Approve COLA",
  reject: "Reject / send back",
};

/** Stage 4 once a decision exists: outlined in the decision's tone while it is only CHOSEN (the
 *  email/record step is still open), solid once it is RECORDED — the same chosen-vs-committed
 *  distinction the DecisionPanel itself draws. */
function DecisionMarker({ decision, recorded }: { decision: DecisionChoice; recorded: boolean }) {
  const tone = toneForStatus(decision === "approve" ? "approve" : "reject");
  const Icon = TONE_ICON[tone];
  if (recorded) {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
        style={{ backgroundColor: TONE_SOLID_VAR[tone] }}
      >
        <span className="sr-only">Decision recorded: {DECISION_LABEL[decision]}. </span>
        {Icon && <Icon className="h-4 w-4" />}
      </span>
    );
  }
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-surface"
      style={{ borderColor: TONE_SOLID_VAR[tone], color: TONE_SOLID_VAR[tone] }}
    >
      <span className="sr-only">Decision chosen, not yet recorded: {DECISION_LABEL[decision]}. </span>
      {Icon && <Icon className="h-4 w-4" />}
    </span>
  );
}

export function PipelineSteps({
  stage,
  verdict,
  decision = null,
  decided = false,
}: {
  stage: Stage;
  verdict?: OverallVerdict;
  /** The Approve/Reject choice made in the DecisionPanel (null until one is chosen). */
  decision?: DecisionChoice | null;
  /** True once the decision has been RECORDED (the panel's commit), completing stage 4. */
  decided?: boolean;
}) {
  // Index of the currently-active step. idle AND reading sit on step 1 (the read is stage 1
  // finishing, not a step of its own); awaiting -> step 2; a verdict -> step 4 until decided.
  const activeIndex = stage === "awaiting" ? 1 : stage === "done" ? (decided ? 4 : 3) : 0;
  return (
    <ol aria-label="How this verification works, in order" className="flex items-start">
      {STEPS.map((label, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
        // The comparison step carries the verdict disc instead of a plain check once a verdict
        // exists; the decision step carries the decision disc once a decision is chosen.
        const showVerdict = i === 2 && stage === "done" && verdict !== undefined;
        const showDecision = i === 3 && stage === "done" && decision !== null;
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
              ) : showDecision ? (
                <DecisionMarker decision={decision} recorded={decided} />
              ) : (
                <StepMarker state={state} n={i + 1} spinning={i === 0 && stage === "reading"} />
              )}
              <span
                className={`h-0.5 flex-1 ${isLast ? "opacity-0" : i < activeIndex ? "bg-brand-500" : "bg-border"}`}
              />
            </div>
            <span
              className={`mt-1.5 px-1 text-xs leading-tight ${state === "pending" && !showVerdict && !showDecision ? "text-ink-muted" : "font-medium text-ink"}`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The pill's one-line summary of where the flow stands — mirrors the spine's active step. */
function pillLabel(stage: Stage, verdict: OverallVerdict | undefined, decision: DecisionChoice | null, decided: boolean): string {
  if (stage === "reading") return "Reading the label…";
  if (stage === "awaiting") return "Complete the application";
  if (stage !== "done") return STEPS[0];
  if (decided && decision) return decision === "approve" ? "Recorded: Approved" : "Recorded: Returned";
  if (decision) return "Record your decision";
  return verdict ? `Verdict: ${VERDICT_LABEL[verdict]}` : STEPS[2];
}

/**
 * PipelineProgressPill — the spine, condensed to a floating chip for the long scroll below the
 * fold (9 application inputs + the result + the decision panel). The verify screen pins it
 * top-left ONLY while the real spine is scrolled out of view (IntersectionObserver), mirroring
 * the fixed Help/Theme controls top-right. Four mini step dots re-state the spine (verdict and
 * decision dots carry their tone colors); the text names the active step. Clicking it jumps back
 * to the spine — it is a navigation button, not a duplicate landmark, so screen readers get one
 * step list plus a labelled shortcut.
 */
export function PipelineProgressPill({
  stage,
  verdict,
  decision = null,
  decided = false,
  onJump,
}: {
  stage: Stage;
  verdict?: OverallVerdict;
  decision?: DecisionChoice | null;
  decided?: boolean;
  onJump: () => void;
}) {
  const activeIndex = stage === "awaiting" ? 1 : stage === "done" ? (decided ? 4 : 3) : 0;
  const label = pillLabel(stage, verdict, decision, decided);
  const dot = (i: number) => {
    const base = "h-2.5 w-2.5 shrink-0 rounded-full transition";
    if (i === 2 && stage === "done" && verdict !== undefined) {
      return <span key={i} className={base} style={{ backgroundColor: TONE_SOLID_VAR[toneForStatus(verdict)] }} />;
    }
    if (i === 3 && stage === "done" && decision !== null) {
      const toneVar = TONE_SOLID_VAR[toneForStatus(decision === "approve" ? "approve" : "reject")];
      return decided ? (
        <span key={i} className={base} style={{ backgroundColor: toneVar }} />
      ) : (
        <span key={i} className={`${base} border-2 bg-surface`} style={{ borderColor: toneVar }} />
      );
    }
    if (i < activeIndex) return <span key={i} className={`${base} bg-brand-600`} />;
    if (i === activeIndex) return <span key={i} className={`${base} border-2 border-brand-600 bg-brand-50`} />;
    return <span key={i} className={`${base} border-2 border-border bg-surface`} />;
  };
  return (
    <button
      type="button"
      onClick={onJump}
      aria-label={`Verification progress: ${label}. Jump back to the steps overview.`}
      className="fixed left-3 top-3 z-40 flex min-h-[40px] items-center gap-2.5 rounded-pill border border-border bg-surface/95 px-3.5 shadow-card backdrop-blur transition hover:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 motion-safe:animate-reveal sm:left-4 sm:top-4"
    >
      <span aria-hidden="true" className="flex items-center gap-1.5">
        {STEPS.map((_, i) => dot(i))}
      </span>
      <span aria-hidden="true" className="max-w-[40vw] truncate text-xs font-semibold text-ink sm:max-w-xs">
        {label}
      </span>
      {stage === "reading" && <IconSpinner className="h-4 w-4 shrink-0 text-brand-700 motion-safe:animate-spin" />}
    </button>
  );
}
