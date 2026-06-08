"use client";

/**
 * VerifyForm — the single "read a label" screen (extraction-first, multi-image).
 *
 * Drop a product's label image(s) — front, back, neck — and the AI reads them TOGETHER into one
 * structured record, then runs the TTB completeness check for the detected beverage type. Results
 * are downloadable as JSON or CSV. No typing. Accessibility (WCAG 2.1 AA): labelled controls,
 * >=44px targets, visible focus, aria-live result regions, focus moved to the result heading.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { VerifyApiResponse, VerifyApiError } from "./api/verify/contract";
import type { LabelPosition } from "@/extraction";
import { confirmVerdict, type ConfirmVerdict, type FieldConfirmation } from "@/compare";
import type { RequirementKey } from "@/domain";
import { ExtractedFieldsView } from "./ui/ExtractedFieldsView";
import { CompletenessView } from "./ui/CompletenessView";
import { ConfirmPanel } from "./ui/ConfirmPanel";
import { downscaleForUpload } from "./imageDownscale";
import { DropZone } from "./ui/DropZone";
import { ErrorAlert } from "./ui/ErrorAlert";
import { ResultSkeleton } from "./ui/ResultSkeleton";
import { secondaryButtonClass } from "./ui/fieldStyles";
import { downloadJson, downloadCsv } from "./ui/download";
import { analysisToCsv } from "@/batch/csv";
import { ImageLightbox } from "./ui/ImageLightbox";
import { ForwardLookingNote } from "./ui/ForwardLookingNote";
import { VERDICT_LABEL } from "./ui/status";
import { IconReview, IconSpinner, IconZoom } from "./ui/icons";

type SubmitState = "idle" | "loading" | "done" | "error";
interface LabelImage {
  file: File;
  preview: string;
  position: LabelPosition;
}
type SlotKey = "front" | "back";

/** The ordered, present-only image list to read/export: front then back. */
const orderedImagesOf = (s: { front?: LabelImage; back?: LabelImage }): LabelImage[] =>
  [s.front, s.back].filter(Boolean) as LabelImage[];

export function VerifyForm({ mockMode = false }: { mockMode?: boolean }) {
  // The label is uploaded into two explicit slots — Front (required) and Back (optional) — so the
  // agent says what each image is; position is fixed by the slot (no order-guessing, no dropdown).
  const [slots, setSlots] = useState<{ front?: LabelImage; back?: LabelImage }>({});
  const [state, setState] = useState<SubmitState>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerifyApiResponse | null>(null);
  const [confirmations, setConfirmations] = useState<Partial<Record<RequirementKey, FieldConfirmation>>>({});
  // The image currently shown full-size in the lightbox, if any.
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  const ids = {
    image: useId(),
    imageHelp: useId(),
    err: useId(),
    heading: useId(),
  };
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const completenessHeadingRef = useRef<HTMLHeadingElement>(null);
  const verdictHeadingRef = useRef<HTMLHeadingElement>(null);
  // Monotonic token so an in-flight read whose image set has since changed is ignored.
  const readToken = useRef(0);

  // When a read completes, move focus to the TOPMOST result heading so a keyboard/screen-reader user
  // lands on the headline outcome the verify-first page leads with — not the third section. Each
  // heading ref is populated ONLY while its section is mounted, so the priority order falls out of
  // which ref exists: verdict (confirm panel) > completeness > extracted / re-upload.
  // Keyed on `state` only so live recompute (confirming fields) never steals focus.
  useEffect(() => {
    if (state !== "done") return;
    const target =
      verdictHeadingRef.current || completenessHeadingRef.current || resultHeadingRef.current;
    target?.focus();
  }, [state]);

  // Derive the confirm verdict from the reading + the human confirmations (no effect, no extra
  // state). Exists the moment a readable extraction is present; each confirmation action updates it.
  const verdict: ConfirmVerdict | null = useMemo(
    () => (state === "done" && response?.readable ? confirmVerdict(response.extracted, confirmations) : null),
    [state, response, confirmations],
  );

  const accept = (key: RequirementKey) => setConfirmations((p) => ({ ...p, [key]: { state: "accepted" } }));
  const edit = (key: RequirementKey, value: string) => setConfirmations((p) => ({ ...p, [key]: { state: "edited", editedValue: value } }));
  const markMissing = (key: RequirementKey) => setConfirmations((p) => ({ ...p, [key]: { state: "missing" } }));

  // Read the current image set (front/back/...) together. Triggered from the handlers, not an
  // effect, so the AI reads automatically the moment images change — with no manual "go" button.
  async function read(imgs: LabelImage[]) {
    if (imgs.length === 0) return;
    const token = ++readToken.current;
    setState("loading");
    setFormError(null);
    try {
      const body = new FormData();
      for (const img of imgs) {
        body.append("image", await downscaleForUpload(img.file));
        body.append("position", img.position);
      }
      const res = await fetch("/api/verify", { method: "POST", body });
      const json: VerifyApiResponse | VerifyApiError = await res.json();
      if (token !== readToken.current) return; // a newer read superseded this one
      if (!res.ok) {
        setFormError((json as VerifyApiError).error || "Reading the label failed.");
        setState("error");
        return;
      }
      setConfirmations({});
      setResponse(json as VerifyApiResponse);
      setState("done");
    } catch {
      if (token === readToken.current) {
        setFormError("Could not reach the label reader. Please try again.");
        setState("error");
      }
    }
  }

  const orderedImages = orderedImagesOf(slots);

  // Put an image in a slot (replacing any existing one), then re-read the fused front+back pair.
  function setSlot(key: SlotKey, file: File) {
    setSlots((prev) => {
      const old = prev[key];
      if (old) {
        if (zoom?.src === old.preview) setZoom(null);
        URL.revokeObjectURL(old.preview); // replacing -> revoke the old object URL
      }
      const next = { ...prev, [key]: { file, preview: URL.createObjectURL(file), position: key as LabelPosition } };
      void read(orderedImagesOf(next));
      return next;
    });
  }
  function clearSlot(key: SlotKey) {
    setSlots((prev) => {
      const target = prev[key];
      if (target) {
        if (zoom?.src === target.preview) setZoom(null); // don't leave the lightbox on a revoked URL
        URL.revokeObjectURL(target.preview);
      }
      const next = { ...prev, [key]: undefined };
      const imgs = orderedImagesOf(next);
      if (imgs.length === 0) {
        readToken.current++; // cancel any in-flight read
        setState("idle");
        setResponse(null);
      } else {
        void read(imgs);
      }
      return next;
    });
  }

  const exportBase = (orderedImages[0]?.file.name ?? "label").replace(/\.[^.]+$/, "");
  function onDownloadJson() {
    if (!response) return;
    downloadJson(`${exportBase}.json`, {
      images: orderedImages.map((i) => ({ filename: i.file.name, position: i.position })),
      provider: response.provider,
      extracted: response.extracted,
      completeness: response.completeness,
      ...(verdict
        ? { confirm: { overall: verdict.overall, awaitingConfirmation: verdict.awaitingConfirmation,
            fields: verdict.fields.map((f) => ({ key: f.key, value: f.value, status: f.status, state: f.state })) } }
        : {}),
    });
  }
  function onDownloadCsv() {
    if (!response) return;
    downloadCsv(`${exportBase}.csv`, analysisToCsv([
      { filename: exportBase, extracted: response.extracted, completeness: response.completeness, overall: verdict?.overall ?? undefined },
    ]));
  }

  const readable = state === "done" && response?.readable;

  return (
    <section
      aria-labelledby={ids.heading}
      aria-busy={state === "loading"}
      className="rounded-card border border-border border-t-4 border-t-brand-600 bg-surface p-6 shadow-card sm:p-8"
    >
      <h2 id={ids.heading} className="text-xl font-semibold text-ink">
        Read &amp; verify a label
      </h2>
      <p className="mt-1 text-ink-muted">
        Upload the product&apos;s front label (and the back, if you have it) and the AI reads them
        together, fills in every field TTB requires for the beverage type, and asks you to confirm or
        correct each. No typing required to read.
      </p>

      {mockMode && (
        <p className="mt-3 rounded-field border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
          <strong className="font-semibold text-ink">Demo mode.</strong> This preview recognizes the
          built-in sample labels only. To read your own photos, a vision provider must be configured —
          see the README.
        </p>
      )}

      {/* Step 1 — upload into explicit Front / Back slots */}
      <div className="mt-6">
        <h3 className="mb-1.5 block font-medium text-ink">1. Label images</h3>
        <p id={ids.imageHelp} className="sr-only">
          Upload the front label (required) and optionally the back label. Click a thumbnail to enlarge it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["front", "back"] as const).map((key) => {
            const img = slots[key];
            const label = key === "front" ? "Front label" : "Back label";
            return (
              <div key={key}>
                <span className="mb-1.5 block text-sm font-medium text-ink">
                  {label}{" "}
                  <span className="font-normal text-ink-muted">{key === "front" ? "(required)" : "(optional)"}</span>
                </span>
                {img ? (
                  <div className="flex items-center gap-3 rounded-card border border-border bg-surface-muted p-3">
                    <button
                      type="button"
                      onClick={() => setZoom({ src: img.preview, alt: `${label} — ${img.file.name}` })}
                      aria-label={`Enlarge ${img.file.name}`}
                      className="group relative h-24 w-24 shrink-0 cursor-zoom-in overflow-hidden rounded border border-border bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                      <img src={img.preview} alt="" className="h-full w-full object-contain" />
                      <span className="absolute bottom-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-sm text-white opacity-90 transition group-hover:opacity-100">
                        <IconZoom />
                      </span>
                    </button>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{img.file.name}</span>
                    <button
                      type="button"
                      onClick={() => clearSlot(key)}
                      className="min-h-[44px] rounded-field border-2 border-border-strong px-3 text-sm font-semibold text-ink transition hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <DropZone
                    id={`${ids.image}-${key}`}
                    multiple={false}
                    ariaLabel={key === "front" ? "Upload front label (required)" : "Upload back label (optional)"}
                    onFiles={(files) => files[0] && setSlot(key, files[0])}
                    describedById={ids.imageHelp}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Persistent live region: the verdict can appear/refresh reactively as the agent confirms
          fields (no `state` change), so the focus-move announcement never fires on that path. This
          polite region announces the headline outcome whenever it appears or changes. */}
      <p role="status" aria-live="polite" className="sr-only">
        {verdict
          ? verdict.awaitingConfirmation
            ? `${verdict.fields.filter((f) => f.needsConfirmation).length} fields need your confirmation.`
            : `Verdict: ${VERDICT_LABEL[verdict.overall]}.`
          : ""}
      </p>

      {formError && (
        <div className="mt-5">
          <ErrorAlert id={ids.err}>{formError}</ErrorAlert>
        </div>
      )}

      {state === "loading" && (
        <>
          <p role="status" aria-live="polite" className="sr-only">
            Reading the label…
          </p>
          <div className="mt-4 flex items-center gap-2 text-ink-muted">
            <IconSpinner className="h-5 w-5 motion-safe:animate-spin" /> Reading the label… this takes a
            few seconds.
          </div>
          <ResultSkeleton />
        </>
      )}

      {/* Results — lead with the confirm panel (verdict + field confirmations), then completeness, then the full reading. */}
      {readable && response && (
        <>
          {verdict && (
            <ConfirmPanel
              verdict={verdict}
              onAccept={accept}
              onEdit={edit}
              onMarkMissing={markMissing}
              headingRef={verdictHeadingRef}
            />
          )}
          {response.completeness && (
            <CompletenessView completeness={response.completeness} headingRef={completenessHeadingRef} />
          )}
          <ExtractedFieldsView extracted={response.extracted} headingRef={resultHeadingRef} />
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={onDownloadJson} className={secondaryButtonClass}>
              Download JSON
            </button>
            <button type="button" onClick={onDownloadCsv} className={secondaryButtonClass}>
              Download CSV
            </button>
            <button type="button" onClick={() => void read(orderedImages)} className={secondaryButtonClass}>
              Read again
            </button>
          </div>
        </>
      )}

      {state === "done" && response && !response.readable && (
        <section role="alert" className="mt-6 rounded-card border-l-8 border-review-500 bg-review-50 p-5 shadow-card">
          <h2
            ref={resultHeadingRef}
            tabIndex={-1}
            className="flex items-center gap-2 text-lg font-semibold text-review-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            <IconReview className="h-6 w-6 shrink-0" /> Couldn&apos;t read the label
          </h2>
          <p className="mt-2 text-review-900">{response.message ?? "Please re-upload a clearer photo."}</p>
        </section>
      )}

      <ForwardLookingNote />

      <ImageLightbox
        open={zoom !== null}
        src={zoom?.src ?? ""}
        alt={zoom?.alt ?? ""}
        onClose={() => setZoom(null)}
      />
    </section>
  );
}
