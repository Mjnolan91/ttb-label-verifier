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
import { verifyLabel, type VerifyResult } from "@/compare";
import { ExtractedFieldsView } from "./ui/ExtractedFieldsView";
import { CompletenessView } from "./ui/CompletenessView";
import { ResultView } from "./ResultView";
import { FormField } from "./ui/FormField";
import { downscaleForUpload } from "./imageDownscale";
import { DropZone } from "./ui/DropZone";
import { ErrorAlert } from "./ui/ErrorAlert";
import { ResultSkeleton } from "./ui/ResultSkeleton";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "./ui/fieldStyles";
import { downloadJson, downloadCsv } from "./ui/download";
import { analysisToCsv } from "@/batch/csv";
import { ImageLightbox } from "./ui/ImageLightbox";
import { ForwardLookingNote } from "./ui/ForwardLookingNote";
import { IconReview, IconSpinner, IconZoom } from "./ui/icons";

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
  // The "verify against the application" values. The deterministic verdict is DERIVED from these +
  // the reading (useMemo below), so the application-match outcome is front-and-center — it appears the
  // moment a reading and the application values both exist, with no extra read and no extra state.
  const [claimed, setClaimed] = useState({ brand: "", alcohol: "", classType: "" });
  // The image currently shown full-size in the lightbox, if any.
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  const ids = {
    image: useId(),
    imageHelp: useId(),
    err: useId(),
    heading: useId(),
    verifyHeading: useId(),
    vBrand: useId(),
    vAlcohol: useId(),
    vClass: useId(),
  };
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const verdictHeadingRef = useRef<HTMLHeadingElement>(null);
  const justVerified = useRef(false);
  // Monotonic token so an in-flight read whose image set has since changed is ignored.
  const readToken = useRef(0);

  // Move focus to the result heading once a read completes.
  useEffect(() => {
    if (state === "done") resultHeadingRef.current?.focus();
  }, [state]);

  // Derive the application-match verdict from the reading + the application values (no effect, no
  // extra state). It exists the moment a readable extraction and brand+alcohol are present, so
  // verification is the headline outcome with no button to hunt for.
  const verdict: VerifyResult | null = useMemo(() => {
    if (state !== "done" || !response?.readable) return null;
    if (claimed.brand.trim() === "" || claimed.alcohol.trim() === "") return null;
    return verifyLabel(
      {
        brand: claimed.brand.trim(),
        alcoholContentText: claimed.alcohol.trim(),
        classType: claimed.classType.trim() || undefined,
      },
      response.extracted,
    );
  }, [state, response, claimed.brand, claimed.alcohol, claimed.classType]);

  // Move focus to the verdict only when the agent explicitly pressed Verify (not on live recompute).
  useEffect(() => {
    if (verdict && justVerified.current) {
      justVerified.current = false;
      verdictHeadingRef.current?.focus();
    }
  }, [verdict]);

  const canVerify =
    state === "done" &&
    Boolean(response?.readable) &&
    claimed.brand.trim() !== "" &&
    claimed.alcohol.trim() !== "";

  // The verdict is computed reactively; pressing Verify just announces/jumps to it.
  function onVerifyClick() {
    justVerified.current = true;
    if (verdict) verdictHeadingRef.current?.focus();
  }

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
    if (target) {
      if (zoom?.src === target.preview) setZoom(null); // don't leave the lightbox on a revoked URL
      URL.revokeObjectURL(target.preview);
    }
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
    const result = verdict ?? response.result;
    downloadJson(`${exportBase}.json`, {
      images: images.map((i) => ({ filename: i.file.name, position: i.position })),
      provider: response.provider,
      extracted: response.extracted,
      completeness: response.completeness,
      ...(result ? { result } : {}),
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
          result: verdict ?? response.result,
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
        Read &amp; verify a label
      </h2>
      <p className="mt-1 text-ink-muted">
        Drop a product&apos;s label image(s) — front, back, neck — and the AI reads them together. Add
        the application values to check the label matches; or just read the label and export the data.
        No typing required to read.
      </p>

      {/* Step 1 — upload */}
      <div className="mt-6">
        <span className="mb-1.5 block font-medium text-ink">
          1. Label images <span className="font-normal text-ink-muted">(one or more; required)</span>
        </span>
        <DropZone id={ids.image} onFiles={addFiles} describedById={ids.imageHelp} />
        <p id={ids.imageHelp} className="sr-only">
          Add the front and any back or neck label images for a single product. Click a thumbnail to
          enlarge it.
        </p>
      </div>

      {images.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {images.map((img, i) => (
            <li
              key={`${img.file.name}-${i}`}
              className="flex items-center gap-3 rounded-card border border-border bg-surface-muted p-3"
            >
              <button
                type="button"
                onClick={() => setZoom({ src: img.preview, alt: `${img.position} label — ${img.file.name}` })}
                aria-label={`Enlarge ${img.file.name}`}
                className="group relative h-28 w-28 shrink-0 cursor-zoom-in overflow-hidden rounded border border-border bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img src={img.preview} alt="" className="h-full w-full object-contain" />
                <span className="absolute bottom-1 right-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-base text-white opacity-90 transition group-hover:opacity-100">
                  <IconZoom />
                </span>
              </button>
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

      {/* Step 2 — the application values to verify against (always visible; this IS the check) */}
      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          onVerifyClick();
        }}
      >
        <h3 id={ids.verifyHeading} className="font-medium text-ink">
          2. What does the application say?{" "}
          <span className="font-normal text-ink-muted">
            (the COLA application — optional, but this is the match check)
          </span>
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Brand name" htmlFor={ids.vBrand}>
            <input
              id={ids.vBrand}
              className={inputClass}
              value={claimed.brand}
              onChange={(e) => setClaimed((c) => ({ ...c, brand: e.target.value }))}
              placeholder="e.g. Old Tom Distillery"
              autoComplete="off"
            />
          </FormField>
          <FormField label="Alcohol content" htmlFor={ids.vAlcohol}>
            <input
              id={ids.vAlcohol}
              className={inputClass}
              value={claimed.alcohol}
              onChange={(e) => setClaimed((c) => ({ ...c, alcohol: e.target.value }))}
              placeholder="e.g. 45% Alc./Vol. (90 Proof)"
              autoComplete="off"
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField
              label="Class / type"
              htmlFor={ids.vClass}
              hint="Optional — helps select the right ABV tolerance (e.g. Bourbon, Table Wine, IPA)."
            >
              <input
                id={ids.vClass}
                className={inputClass}
                value={claimed.classType}
                onChange={(e) => setClaimed((c) => ({ ...c, classType: e.target.value }))}
                placeholder="e.g. Kentucky Straight Bourbon Whiskey"
                autoComplete="off"
              />
            </FormField>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryButtonClass} disabled={!canVerify}>
            Verify against the application
          </button>
          <span className="text-sm text-ink-muted">
            Brand, alcohol content, and the government warning are checked against the label.
          </span>
        </div>
      </form>

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

      {/* Results — lead with the application-match verdict, then completeness, then the full reading. */}
      {readable && response && (
        <>
          {verdict && <ResultView result={verdict} headingRef={verdictHeadingRef} />}
          {response.completeness && <CompletenessView completeness={response.completeness} />}
          <ExtractedFieldsView extracted={response.extracted} headingRef={resultHeadingRef} />
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={onDownloadJson} className={secondaryButtonClass}>
              Download JSON
            </button>
            <button type="button" onClick={onDownloadCsv} className={secondaryButtonClass}>
              Download CSV
            </button>
            <button type="button" onClick={() => void read(images)} className={secondaryButtonClass}>
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
