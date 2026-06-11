"use client";

/**
 * DecisionPanel — the terminal step a reviewer takes after the verdict: record an Approve or a
 * Reject / send-back decision and (optionally) send a notification email to the applicant. The draft is
 * seeded with REVIEWER NOTES drawn from the tool's status (the open issues with their reasons for a
 * send-back; what the reviewer confirmed for an approval), which the reviewer can edit before sending.
 * "Sending" is a DEMO confirmation only — this offline prototype has no mail transport, stores no PII,
 * and has no real COLA system behind it.
 */
import { useRef, useState } from "react";
import { IconPass, IconFail } from "./icons";
import { inputClass } from "./fieldStyles";
import type { OverallVerdict } from "@/compare";

type Decision = "approve" | "reject";

/** Compose the applicant email from the decision and the (editable) reviewer notes. The notes are the
 *  one place the tool's status reaches the applicant, so they are woven into the body verbatim. */
function emailFor(decision: Decision, brand: string, notes: string): { subject: string; body: string } {
  const product = brand.trim() || "this product";
  const trimmed = notes.trim();
  if (decision === "approve") {
    const notesBlock = trimmed ? `\n\nReviewer notes:\n${trimmed}` : "";
    return {
      subject: `TTB COLA decision: ${product} approved`,
      body:
        `Dear Applicant,\n\n` +
        `Your Certificate of Label Approval (COLA) application for "${product}" has been APPROVED. The ` +
        `label matches the application and meets the applicable TTB labeling requirements.` +
        notesBlock +
        `\n\nYou may proceed to market this product under the approved label.\n\n` +
        `Regards,\nTTB Label Review`,
    };
  }
  const corrections = trimmed ? `\n\n${trimmed}` : `\n\n  - See the reviewer's notes.`;
  return {
    subject: `TTB COLA: ${product} returned for revision`,
    body:
      `Dear Applicant,\n\n` +
      `Your Certificate of Label Approval (COLA) application for "${product}" has been RETURNED FOR ` +
      `REVISION. Please correct the following item(s) before resubmitting:` +
      corrections +
      `\n\nResubmit the corrected label at your convenience.\n\n` +
      `Regards,\nTTB Label Review`,
  };
}

export function DecisionPanel({
  verdict,
  brand,
  approveNotes,
  rejectNotes,
  onRecord,
  initialDecision = null,
  initialNote,
  step,
}: {
  verdict: OverallVerdict;
  brand: string;
  /** Reviewer notes seeded into an APPROVAL email, drawn from what the reviewer confirmed. */
  approveNotes: string;
  /** Reviewer notes seeded into a SEND-BACK email: the open issues with their reasons. */
  rejectNotes: string;
  /** Called when the reviewer commits (sends) — lets a worklist record the decision + note. */
  onRecord?: (decision: Decision, note: string) => void;
  /** A previously recorded decision to resume (e.g. reopening a worklist item). */
  initialDecision?: Decision | null;
  /** The note captured with a previously recorded decision. */
  initialNote?: string;
  /** Optional step eyebrow (e.g. "Step 4") shown above the heading on the numbered single-screen flow. */
  step?: string;
}) {
  const seedFor = (d: Decision) => (d === "approve" ? approveNotes : rejectNotes);
  const [decision, setDecision] = useState<Decision | null>(initialDecision);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(() =>
    initialDecision ? emailFor(initialDecision, brand, initialNote ?? seedFor(initialDecision)).subject : "",
  );
  const [notes, setNotes] = useState(() =>
    initialDecision ? (initialNote ?? seedFor(initialDecision)) : "",
  );
  const [sent, setSent] = useState(false);
  // The seed (field-note-derived notes) currently reflected in the editor, so we can tell when the
  // reviewer's field notes changed AFTER the email was composed and offer to pull the update in.
  const [appliedSeed, setAppliedSeed] = useState<string | null>(
    initialDecision ? (initialNote ?? seedFor(initialDecision)) : null,
  );
  const fieldNotesChanged = decision !== null && appliedSeed !== null && seedFor(decision) !== appliedSeed;

  // FOCUS FOLLOWS THE FLOW. The email composer mounts BELOW the fold in the batch drawer, so a
  // reviewer who clicks Approve/Reject can record a decision without ever seeing the applicant
  // email under their click. Each state change moves focus (and scrolls) to the thing that just
  // appeared: choose -> the composer, send -> the "Recorded" confirmation (focus doubles as the
  // announcement; a conditionally-mounted live region alone is routinely missed by screen
  // readers), change-decision -> back to the Approve/Reject pair. jsdom lacks scrollIntoView and
  // matchMedia, hence the guards.
  const composerRef = useRef<HTMLDivElement>(null);
  const recordedRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);
  // Scheduled via a ZERO TIMEOUT, not a render effect and not requestAnimationFrame: React commits
  // the click's state synchronously before timers run, so the target exists by then — and when the
  // click changes NOTHING (re-clicking the already-resumed decision) React bails out of rendering
  // entirely, so a render-driven effect never fires (preview-measured: the resumed drawer's Approve
  // click left the composer below the fold). rAF is equally unusable: hidden/background tabs pause
  // animation frames indefinitely. Focus goes FIRST with preventScroll, then the scroll (a focus()
  // after scrollIntoView cancels an in-flight smooth scroll in Chromium); the scroll animates only
  // when the page is actually visible — smooth scrolling is frame-driven and would stall hidden.
  function focusPanelTarget(target: "composer" | "recorded" | "buttons") {
    setTimeout(() => {
      const el =
        target === "composer"
          ? composerRef.current
          : target === "recorded"
            ? recordedRef.current
            : buttonsRef.current;
      if (!el) return;
      const reduceMotion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const smoothOk = !reduceMotion && typeof document !== "undefined" && document.visibilityState !== "hidden";
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ behavior: smoothOk ? "smooth" : "auto", block: "start" });
    }, 0);
  }

  function choose(d: Decision) {
    const seeded = seedFor(d);
    setDecision(d);
    setSubject(emailFor(d, brand, seeded).subject);
    setNotes(seeded);
    setAppliedSeed(seeded);
    setSent(false);
    focusPanelTarget("composer");
  }

  function pullFieldNotes() {
    if (!decision) return;
    const seeded = seedFor(decision);
    setNotes(seeded);
    setAppliedSeed(seeded);
  }

  function send() {
    if (decision) onRecord?.(decision, notes);
    setSent(true);
    focusPanelTarget("recorded");
  }

  // The live draft — recomposed from the editable notes so the preview always matches what will "send".
  const draftBody = decision ? emailFor(decision, brand, notes).body : "";

  // The verdict suggests the decision (Needs review leaves it to the reviewer).
  const recommended: Decision | null = verdict === "approve" ? "approve" : verdict === "reject" ? "reject" : null;

  // A plain render helper (NOT a component) so it doesn't reset state each render.
  const decisionButton = (d: Decision) => {
    const active = decision === d;
    // bg-surface lives ONLY on the inactive branches: it has equal specificity to the solid tones,
    // so if both classes are present the compiled stylesheet's emission order (not class order) picks
    // the winner — which rendered the selected button white-on-white.
    const tone =
      d === "approve"
        ? active
          ? "border-pass-700 bg-pass-700 text-white"
          : "border-pass-600 bg-surface text-pass-700 hover:bg-pass-50"
        : active
          ? "border-fail-700 bg-fail-700 text-white"
          : "border-fail-600 bg-surface text-fail-700 hover:bg-fail-50";
    return (
      <button
        type="button"
        onClick={() => choose(d)}
        aria-pressed={active}
        className={`inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-field border-2 px-4 text-base font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${tone}`}
      >
        {d === "approve" ? <IconPass className="h-5 w-5" /> : <IconFail className="h-5 w-5" />}
        {d === "approve" ? "Approve COLA" : "Reject / send back"}
        {recommended === d && (
          <span className="rounded-pill bg-black/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
            Recommended
          </span>
        )}
      </button>
    );
  };

  return (
    <section
      aria-label="Record your decision"
      className="mt-6 rounded-card border border-border bg-surface p-5 shadow-card sm:p-6"
    >
      {step && <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{step}</p>}
      <h2 className="text-lg font-semibold text-ink">Record your decision</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Commit the review and notify the applicant. Demo only: no email actually leaves this prototype.
      </p>
      <div
        ref={buttonsRef}
        tabIndex={-1}
        role="group"
        aria-label="Decision"
        className="mt-4 flex flex-col gap-3 focus-visible:outline-none sm:flex-row"
      >
        {decisionButton("approve")}
        {decisionButton("reject")}
      </div>

      {decision && !sent && (
        <div
          ref={composerRef}
          tabIndex={-1}
          role="group"
          aria-label="Email to the applicant"
          className="mt-5 scroll-mt-4 rounded-card border border-border bg-surface-muted p-4 focus-visible:outline-none"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Email to the applicant</p>
          <div className="mt-3 flex flex-col gap-3">
            <label className="block text-sm font-medium text-ink">
              To
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="applicant@example.com"
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              Subject
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className={`mt-1 ${inputClass}`} />
            </label>
            <label className="block text-sm font-medium text-ink">
              Reviewer notes
              <span className="ml-1 font-normal text-ink-muted">
                ({decision === "approve" ? "what you confirmed" : "what to correct"}; edit as needed)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={notes.split("\n").length > 4 ? notes.split("\n").length + 1 : 5}
                placeholder="Add any notes for the applicant."
                className={`mt-1 min-h-[6rem] w-full resize-y rounded-field border-2 border-border-strong bg-surface px-3 py-2.5 font-sans text-sm leading-relaxed text-ink shadow-sm transition focus-visible:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2`}
              />
            </label>
            {fieldNotesChanged && (
              <div className="flex flex-wrap items-center gap-2 rounded-field border-l-4 border-review-500 bg-review-50 px-3 py-2 text-sm text-review-900">
                <span>Your field notes changed since this email was drafted.</span>
                <button
                  type="button"
                  onClick={pullFieldNotes}
                  className="font-semibold text-brand-700 underline underline-offset-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                >
                  Update the email from your field notes
                </button>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Email preview</p>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-field border border-border bg-surface px-3 py-2.5 font-sans text-sm leading-relaxed text-ink">
                {draftBody}
              </pre>
            </div>
          </div>
          <button
            type="button"
            onClick={send}
            className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-field bg-brand-600 px-5 font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            {onRecord ? "Record decision & send email" : "Send email to applicant"}
          </button>
        </div>
      )}

      {sent && decision && (
        <div
          ref={recordedRef}
          tabIndex={-1}
          role="status"
          className="mt-5 flex items-start gap-3 rounded-card border-l-4 border-pass-600 bg-pass-50 p-4 text-pass-900 focus-visible:outline-none"
        >
          <IconPass className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">
              Recorded: {decision === "approve" ? "Approved" : "Returned for revision"}.
            </p>
            <p className="mt-0.5 text-sm">
              A notification was sent to {to.trim() || "the applicant"} (demo, no message actually left this
              prototype).{" "}
              <button
                type="button"
                onClick={() => {
                  setSent(false);
                  setDecision(null);
                  focusPanelTarget("buttons");
                }}
                className="font-semibold text-brand-700 underline underline-offset-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
              >
                Change decision
              </button>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
