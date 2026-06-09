"use client";
/**
 * ProductReview — one product's full human-in-the-loop review, used inside the batch worklist drawer.
 * It is the batch counterpart of the single screen's results section, built from the SAME pieces
 * (ResultView + CompletenessView + DecisionPanel) driven by the SAME shared derivation
 * (deriveLabelReview), so resolving a flag, the CFR-violation confirm-guard, and the tool-status email
 * notes all behave identically to the single screen. The label image(s) are shown inline so the agent
 * can verify a flagged field without leaving the drawer.
 */
import { deriveLabelReview, type FieldNotes, type FieldOverrides, type ReviewDecision } from "./labelReview";
import type { CombinedVerdict, VerifyFieldKey } from "@/compare";
import type { FieldOverride } from "./ResultView";
import { ResultView } from "./ResultView";
import { CompletenessView } from "./CompletenessView";
import { DecisionPanel } from "./DecisionPanel";
import { IconReview } from "./icons";

export function ProductReview({
  brand,
  images,
  combined,
  readable,
  unreadableMessage,
  overrides,
  onOverride,
  notes,
  onNote,
  decision,
  note,
  onRecordDecision,
}: {
  brand: string;
  images: { src: string; alt: string }[];
  combined: CombinedVerdict | null;
  readable: boolean;
  unreadableMessage?: string;
  overrides: FieldOverrides;
  onOverride: (key: VerifyFieldKey, value: FieldOverride | undefined) => void;
  notes: FieldNotes;
  onNote: (key: VerifyFieldKey, text: string) => void;
  decision?: ReviewDecision;
  note?: string;
  onRecordDecision: (decision: ReviewDecision, note: string) => void;
}) {
  const review = combined ? deriveLabelReview(combined, overrides, notes) : null;
  // A completeness-only product (no application row) has no comparison verdict; suggest from completeness.
  const panelVerdict =
    review?.effectiveOverall ?? (combined?.completeness.overall === "complete" ? "approve" : "review");

  return (
    <div className="flex flex-col gap-4">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {images.map((im, i) => (
            <li key={`${im.alt}-${i}`} className="overflow-hidden rounded-card border border-border bg-surface-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
              <img src={im.src} alt={im.alt} className="h-40 w-auto max-w-[14rem] object-contain" />
            </li>
          ))}
        </ul>
      )}

      {!readable ? (
        <section role="alert" className="rounded-card border-l-8 border-review-500 bg-review-50 p-5 shadow-card">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-review-900">
            <IconReview className="h-6 w-6 shrink-0" /> Couldn&apos;t read this label
          </h3>
          <p className="mt-2 text-review-900">
            {unreadableMessage ?? "Re-upload a clearer photo, then read the batch again."}
          </p>
        </section>
      ) : combined?.verify ? (
        <>
          <ResultView
            result={combined.verify}
            overall={review?.effectiveOverall ?? undefined}
            gatedByCompleteness={review?.effectiveGatedByCompleteness ?? false}
            overrides={overrides}
            onOverride={onOverride}
            concerns={review?.completenessConcerns}
            notes={notes}
            onNote={onNote}
          />
          <details className="rounded-card border border-border bg-surface-muted p-4">
            <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
              Supporting check: TTB completeness
            </summary>
            {combined && (
              <CompletenessView completeness={combined.completeness} overrides={review?.completenessOverrides} />
            )}
          </details>
        </>
      ) : (
        combined && <CompletenessView completeness={combined.completeness} overrides={review?.completenessOverrides} />
      )}

      {readable && combined && (
        <DecisionPanel
          verdict={panelVerdict}
          brand={brand}
          approveNotes={review?.approveNotes ?? ""}
          rejectNotes={review?.rejectNotes ?? ""}
          onRecord={onRecordDecision}
          initialDecision={decision ?? null}
          initialNote={note}
        />
      )}
    </div>
  );
}
