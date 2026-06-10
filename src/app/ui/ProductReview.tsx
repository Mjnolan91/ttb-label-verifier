"use client";
/**
 * ProductReview — one product's full human-in-the-loop review, used inside the batch worklist drawer.
 * It is the batch counterpart of the single screen's results section, built from the SAME pieces
 * (ResultView + CompletenessView + DecisionPanel) driven by the SAME shared derivation
 * (deriveLabelReview), so resolving a flag, the CFR-violation confirm-guard, and the tool-status email
 * notes all behave identically to the single screen.
 *
 * Every settled product is reviewable here, whatever its state:
 *  - application comparison ran -> ResultView field cards (confirm / flag / note per field);
 *  - completeness-only (no application CSV row) -> a synthesized, honest "Label completeness" review
 *    whose missing/malformed elements render as the SAME resolvable concern cards, so a no-CSV batch
 *    is never reviewable in name only;
 *  - unreadable / errored -> the re-scan prompt plus a recordable send-back decision.
 * The label image(s) are shown inline and every thumbnail (and the per-card "View label photo"
 * button) opens a zoomable lightbox, so the confirm-the-photo action the copy asks for is honestly
 * performable without leaving the drawer.
 */
import { useState } from "react";
import { deriveLabelReview, type FieldNotes, type FieldOverrides, type ReviewDecision } from "./labelReview";
import { resolveCompletenessOverall } from "@/compare";
import type { CombinedVerdict, FieldResult, VerifyFieldKey, VerifyResult } from "@/compare";
import type { FieldOverride } from "./ResultView";
import { ResultView } from "./ResultView";
import { CompletenessView } from "./CompletenessView";
import { DecisionPanel } from "./DecisionPanel";
import { ImageLightbox } from "./ImageLightbox";
import { IconReview, IconZoom } from "./icons";

/** Placeholder accessor for the synthesized completeness-only result: ResultView reads only
 *  `fields` + `overall`; the named accessors exist to satisfy the VerifyResult shape. */
const NO_COMPARISON: FieldResult = { status: "review", claimed: "", extracted: "", reason: "" };

/** A display-only VerifyResult for a product with NO application values: zero comparison cards, the
 *  headline driven by the (override-resolved) completeness verdict. The missing/malformed elements
 *  arrive separately as `concerns`, which ResultView turns into resolvable synthesized cards. */
function completenessOnlyResult(overall: VerifyResult["overall"]): VerifyResult {
  return { fields: [], brand: NO_COMPARISON, alcohol: NO_COMPARISON, warning: NO_COMPARISON, overall };
}

const RESCAN_NOTE =
  "  - Label image: could not be read clearly. Please resubmit a clearer, well-lit scan with the label flat and in focus.";

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
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const viewFirstImage = images.length > 0 ? () => setZoom(images[0]) : undefined;

  // The completeness verdict AFTER the reviewer's resolved flags, for the completeness-only path:
  // confirming each missing/malformed element flips the suggestion to Approve instead of stranding
  // it on review forever.
  const resolvedCompleteness = combined
    ? resolveCompletenessOverall(combined.completeness, review?.completenessOverrides ?? {})
    : null;
  const completenessOverall: VerifyResult["overall"] = resolvedCompleteness === "complete" ? "approve" : "review";
  const panelVerdict = !readable ? "review" : (review?.effectiveOverall ?? completenessOverall);

  const completenessOnlyNextStep =
    completenessOverall === "approve"
      ? "Every element TTB requires for this beverage type was found on the label. No application values were provided to compare, so record your decision from the label alone."
      : "No application values were provided to compare; this is the label-only completeness review. Confirm or flag each highlighted element below, then record your decision.";

  return (
    <div className="flex flex-col gap-4">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {images.map((im, i) => (
            <li key={`${im.alt}-${i}`} className="overflow-hidden rounded-card border border-border bg-surface-sunken">
              <button
                type="button"
                onClick={() => setZoom(im)}
                aria-label={`Enlarge ${im.alt}`}
                title={im.alt}
                className="group relative block cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img src={im.src} alt={im.alt} className="h-40 w-auto max-w-[14rem] object-contain" />
                <span className="absolute bottom-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-xs text-white opacity-90 transition group-hover:opacity-100">
                  <IconZoom />
                </span>
              </button>
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
          <p className="mt-2 text-sm text-review-900">
            You can still record a decision below, for example a send-back asking for a clearer scan.
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
            onViewImage={viewFirstImage}
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
        combined && (
          <>
            {/* Completeness-only review (no application row): the SAME resolvable concern cards as
                the comparison path, under an honest heading — never "Label vs. application". */}
            <ResultView
              result={completenessOnlyResult(completenessOverall)}
              heading="Label completeness (no application values)"
              nextStepOverride={completenessOnlyNextStep}
              overrides={overrides}
              onOverride={onOverride}
              onViewImage={viewFirstImage}
              concerns={review?.completenessConcerns}
              notes={notes}
              onNote={onNote}
            />
            <details className="rounded-card border border-border bg-surface-muted p-4">
              <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
                Full TTB completeness breakdown
              </summary>
              <CompletenessView completeness={combined.completeness} overrides={review?.completenessOverrides} />
            </details>
          </>
        )
      )}

      <DecisionPanel
        verdict={panelVerdict}
        brand={brand}
        approveNotes={review?.approveNotes ?? ""}
        rejectNotes={!readable ? RESCAN_NOTE : (review?.rejectNotes ?? "")}
        onRecord={onRecordDecision}
        initialDecision={decision ?? null}
        initialNote={note}
      />

      <ImageLightbox
        open={zoom !== null}
        src={zoom?.src ?? ""}
        alt={zoom?.alt ?? ""}
        onClose={() => setZoom(null)}
      />
    </div>
  );
}
