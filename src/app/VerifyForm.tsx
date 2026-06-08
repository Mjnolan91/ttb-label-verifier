"use client";

/**
 * VerifyForm — the single "read a label" screen (extraction-first, multi-image).
 *
 * Drop a product's label image(s) — front, back, neck — and the AI reads them TOGETHER into one
 * structured record, then runs the TTB completeness check for the detected beverage type. Results
 * are downloadable as JSON or CSV. No typing. Accessibility (WCAG 2.1 AA): labelled controls,
 * >=44px targets, visible focus, aria-live result regions, focus moved to the result heading.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { VerifyApiResponse, VerifyApiError } from "./api/verify/contract";
import type { LabelPosition } from "@/extraction";
import { ExtractedFieldsView } from "./ui/ExtractedFieldsView";
import { CompletenessView } from "./ui/CompletenessView";
import { downscaleForUpload } from "./imageDownscale";
import { DropZone } from "./ui/DropZone";
import { ErrorAlert } from "./ui/ErrorAlert";
import { ResultSkeleton } from "./ui/ResultSkeleton";
import { secondaryButtonClass } from "./ui/fieldStyles";
import { downloadJson, downloadCsv } from "./ui/download";
import { analysisToCsv } from "@/batch/csv";
import { IconReview, IconSpinner } from "./ui/icons";

type SubmitState = "idle" | "loading" | "done" | "error";
interface LabelImage {
  file: File;
  preview: string;
  position: LabelPosition;
}
const POSITIONS: LabelPosition[] = ["front", "back", "neck", "other"];
const guessPosition = (index: number): LabelPosition =>
  index === 0 ? "front" : index === 1 ? "back" : "other";

export function VerifyForm() {
  const [images, setImages] = useState<LabelImage[]>([]);
  const [state, setState] = useState<SubmitState>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerifyApiResponse | null>(null);

  const ids = { image: useId(), imageHelp: useId(), err: useId(), heading: useId() };
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  // Monotonic token so an in-flight read whose image set has since changed is ignored.
  const readToken = useRef(0);

  // Move focus to the result heading once a read completes.
  useEffect(() => {
    if (state === "done") resultHeadingRef.current?.focus();
  }, [state]);

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
      setResponse(json as VerifyApiResponse);
      setState("done");
    } catch {
      if (token === readToken.current) {
        setFormError("Could not reach the label reader. Please try again.");
        setState("error");
      }
    }
  }

  function addFiles(files: File[]) {
    const next = [
      ...images,
      ...files.map((file, i) => ({
        file,
        preview: URL.createObjectURL(file),
        position: guessPosition(images.length + i),
      })),
    ];
    setImages(next);
    void read(next);
  }
  function setPosition(index: number, position: LabelPosition) {
    const next = images.map((img, i) => (i === index ? { ...img, position } : img));
    setImages(next);
    void read(next);
  }
  function removeImage(index: number) {
    const target = images[index];
    if (target) URL.revokeObjectURL(target.preview);
    const next = images.filter((_, i) => i !== index);
    setImages(next);
    if (next.length === 0) {
      readToken.current++; // cancel any in-flight read
      setState("idle");
      setResponse(null);
    } else {
      void read(next);
    }
  }

  const exportBase = (images[0]?.file.name ?? "label").replace(/\.[^.]+$/, "");
  function onDownloadJson() {
    if (!response) return;
    downloadJson(`${exportBase}.json`, {
      images: images.map((i) => ({ filename: i.file.name, position: i.position })),
      provider: response.provider,
      extracted: response.extracted,
      completeness: response.completeness,
      ...(response.result ? { result: response.result } : {}),
    });
  }
  function onDownloadCsv() {
    if (!response) return;
    downloadCsv(
      `${exportBase}.csv`,
      analysisToCsv([
        {
          filename: exportBase,
          extracted: response.extracted,
          result: response.result,
          completeness: response.completeness,
        },
      ]),
    );
  }

  const readable = state === "done" && response?.readable;

  return (
    <section
      aria-labelledby={ids.heading}
      aria-busy={state === "loading"}
      className="rounded-card border border-border border-t-4 border-t-brand-600 bg-surface p-6 shadow-card sm:p-8"
    >
      <h2 id={ids.heading} className="text-xl font-semibold text-ink">
        Read a label
      </h2>
      <p className="mt-1 text-ink-muted">
        Drop a product&apos;s label image(s) — front, back, neck — and the AI reads them together into
        structured data, checked against TTB&apos;s required elements. Export as JSON or CSV. No typing.
      </p>

      <div className="mt-6">
        <span className="mb-1.5 block font-medium text-ink">
          Label images <span className="font-normal text-ink-muted">(one or more; required)</span>
        </span>
        <DropZone id={ids.image} onFiles={addFiles} describedById={ids.imageHelp} />
        <p id={ids.imageHelp} className="sr-only">
          Add the front and any back or neck label images for a single product.
        </p>
      </div>

      {images.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {images.map((img, i) => (
            <li
              key={`${img.file.name}-${i}`}
              className="flex items-center gap-3 rounded-card border border-border bg-surface-muted p-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
              <img
                src={img.preview}
                alt={`Preview of ${img.file.name}`}
                className="h-16 w-16 shrink-0 rounded border border-border bg-white object-contain"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{img.file.name}</span>
              <label className="sr-only" htmlFor={`${ids.image}-pos-${i}`}>
                Label position for {img.file.name}
              </label>
              <select
                id={`${ids.image}-pos-${i}`}
                value={img.position}
                onChange={(e) => setPosition(i, e.target.value as LabelPosition)}
                className="min-h-[44px] rounded-field border-2 border-border-strong bg-surface px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
              >
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="min-h-[44px] rounded-field border-2 border-border-strong px-3 text-sm font-semibold text-ink transition hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

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
            <IconSpinner className="h-5 w-5 motion-safe:animate-spin" /> Reading the label…
          </div>
          <ResultSkeleton />
        </>
      )}

      {readable && response && (
        <>
          <ExtractedFieldsView extracted={response.extracted} headingRef={resultHeadingRef} />
          {response.completeness && <CompletenessView completeness={response.completeness} />}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={onDownloadJson} className={secondaryButtonClass}>
              Download JSON
            </button>
            <button type="button" onClick={onDownloadCsv} className={secondaryButtonClass}>
              Download CSV
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
    </section>
  );
}
