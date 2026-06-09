"use client";

/**
 * DecisionPanel — the terminal step a reviewer takes after the verdict: record an Approve or a
 * Reject / send-back decision and (optionally) send a notification email to the applicant. The email is
 * composed from the verdict plus any outstanding issues; "sending" is a DEMO confirmation only — this
 * offline prototype has no mail transport, stores no PII, and has no real COLA system behind it.
 */
import { useState } from "react";
import { IconPass, IconFail } from "./icons";
import { inputClass } from "./fieldStyles";
import type { OverallVerdict } from "@/compare";

type Decision = "approve" | "reject";

function emailFor(decision: Decision, brand: string, issues: string[]): { subject: string; body: string } {
  const product = brand.trim() || "this product";
  if (decision === "approve") {
    return {
      subject: `TTB COLA decision: ${product} approved`,
      body:
        `Dear Applicant,\n\n` +
        `Your Certificate of Label Approval (COLA) application for "${product}" has been APPROVED. The ` +
        `label matches the application and meets the applicable TTB labeling requirements.\n\n` +
        `You may proceed to market this product under the approved label.\n\n` +
        `Regards,\nTTB Label Review`,
    };
  }
  const list = issues.length ? issues.map((i) => `  - ${i}`).join("\n") : "  - See the reviewer's notes.";
  return {
    subject: `TTB COLA: ${product} returned for revision`,
    body:
      `Dear Applicant,\n\n` +
      `Your Certificate of Label Approval (COLA) application for "${product}" has been RETURNED FOR ` +
      `REVISION. Please correct the following item(s) before resubmitting:\n\n${list}\n\n` +
      `Resubmit the corrected label at your convenience.\n\n` +
      `Regards,\nTTB Label Review`,
  };
}

export function DecisionPanel({
  verdict,
  brand,
  issues,
}: {
  verdict: OverallVerdict;
  brand: string;
  issues: string[];
}) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  function choose(d: Decision) {
    const e = emailFor(d, brand, issues);
    setDecision(d);
    setSubject(e.subject);
    setBody(e.body);
    setSent(false);
  }

  // The verdict suggests the decision (Needs review leaves it to the reviewer).
  const recommended: Decision | null = verdict === "approve" ? "approve" : verdict === "reject" ? "reject" : null;

  // A plain render helper (NOT a component) so it doesn't reset state each render.
  const decisionButton = (d: Decision) => {
    const active = decision === d;
    const tone =
      d === "approve"
        ? active
          ? "border-pass-700 bg-pass-700 text-white"
          : "border-pass-600 text-pass-700 hover:bg-pass-50"
        : active
          ? "border-fail-700 bg-fail-700 text-white"
          : "border-fail-600 text-fail-700 hover:bg-fail-50";
    return (
      <button
        type="button"
        onClick={() => choose(d)}
        aria-pressed={active}
        className={`inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-field border-2 bg-surface px-4 text-base font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${tone}`}
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
      <h2 className="text-lg font-semibold text-ink">Record your decision</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Commit the review and notify the applicant. Demo only: no email actually leaves this prototype.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        {decisionButton("approve")}
        {decisionButton("reject")}
      </div>

      {decision && !sent && (
        <div className="mt-5 rounded-card border border-border bg-surface-muted p-4">
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
              Message
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={9}
                className={`mt-1 min-h-[11rem] w-full resize-y rounded-field border-2 border-border-strong bg-surface px-3 py-2.5 font-sans text-sm leading-relaxed text-ink shadow-sm transition focus-visible:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2`}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => setSent(true)}
            className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-field bg-brand-600 px-5 font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            Send email to applicant
          </button>
        </div>
      )}

      {sent && decision && (
        <div
          role="status"
          className="mt-5 flex items-start gap-3 rounded-card border-l-4 border-pass-600 bg-pass-50 p-4 text-pass-900"
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
