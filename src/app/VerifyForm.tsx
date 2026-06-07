"use client";

/**
 * VerifyForm — the single, accessible "read a label" screen (extraction-first).
 *
 * Drop or pick a label image (or click a sample) and the AI reads it AUTOMATICALLY — no typing.
 * The extracted fields render as structured data with a per-field confidence, downloadable as JSON
 * or CSV. Verification (checking the label against an application) is an OPTIONAL collapsible step:
 * enter the claimed values and it additionally shows a per-field verdict. Accessibility (WCAG 2.1
 * AA): labelled controls, >=44px targets, visible focus, aria-live result, focus moved to the
 * result heading on completion.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { VerifyApiResponse, VerifyApiError } from "./api/verify/contract";
import { ResultView } from "./ResultView";
import { ExtractedFieldsView } from "./ui/ExtractedFieldsView";
import { downscaleForUpload } from "./imageDownscale";
import { DropZone } from "./ui/DropZone";
import { FormField } from "./ui/FormField";
import { ErrorAlert } from "./ui/ErrorAlert";
import { ResultSkeleton } from "./ui/ResultSkeleton";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "./ui/fieldStyles";
import { downloadJson, downloadCsv } from "./ui/download";
import { analysisToCsv } from "@/batch/csv";
import { IconReview, IconSpinner } from "./ui/icons";

type SubmitState = "idle" | "loading" | "done" | "error";

interface Claims {
  brand: string;
  alcohol: string;
  classType: string;
  netContents: string;
}

/** Bundled sample labels (served from /public/samples) — real readable images the AI reads live. */
const SAMPLES: ReadonlyArray<{ file: string; label: string }> = [
  { file: "demo-old-tom-clean.png", label: "Clean bourbon label" },
  { file: "demo-warning-title-case.png", label: "Title-case warning" },
  { file: "demo-brand-typo.png", label: "Brand typo" },
  { file: "abc-single-barrel-clean.jpg", label: "Real photo (ABC Rye)" },
];

export function VerifyForm() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [brand, setBrand] = useState("");
  const [alcohol, setAlcohol] = useState("");
  const [classType, setClassType] = useState("");
  const [netContents, setNetContents] = useState("");

  const [state, setState] = useState<SubmitState>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerifyApiResponse | null>(null);

  const ids = {
    image: useId(),
    imageErr: useId(),
    brand: useId(),
    alcohol: useId(),
    classType: useId(),
    netContents: useId(),
    formErr: useId(),
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the result heading once a read is in (it is also an aria-live region).
  useEffect(() => {
    if (state === "done") resultHeadingRef.current?.focus();
  }, [state]);

  // Revoke the object URL when the preview changes or the component unmounts (no leaks).
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function submitAnalysis(f: File, claimed?: Claims) {
    setState("loading");
    setFormError(null);
    try {
      // Shrink large photos before upload to cut latency/cost (no-op for small/vector images).
      const uploadFile = await downscaleForUpload(f);
      const body = new FormData();
      body.set("image", uploadFile);
      // Claimed values are OPTIONAL — sent only to request the additional verification verdict.
      if (claimed?.brand.trim()) body.set("brand", claimed.brand.trim());
      if (claimed?.alcohol.trim()) body.set("alcoholContent", claimed.alcohol.trim());
      if (claimed?.classType.trim()) body.set("classType", claimed.classType.trim());
      if (claimed?.netContents.trim()) body.set("netContents", claimed.netContents.trim());

      const res = await fetch("/api/verify", { method: "POST", body });
      const json: VerifyApiResponse | VerifyApiError = await res.json();
      if (!res.ok) {
        setFormError((json as VerifyApiError).error || "Reading the label failed.");
        setState("error");
        return;
      }
      setResponse(json as VerifyApiResponse);
      setState("done");
    } catch {
      setFormError("Could not reach the label reader. Please try again.");
      setState("error");
    }
  }

  // Selecting/dropping an image reads it immediately (no typing, no button).
  function pickFile(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    void submitAnalysis(f);
  }

  function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      setFormError("Choose or drop a label image first.");
      fileInputRef.current?.focus();
      return;
    }
    void submitAnalysis(file, { brand, alcohol, classType, netContents });
  }

  async function loadSample(s: (typeof SAMPLES)[number]) {
    setFormError(null);
    try {
      const res = await fetch(`/samples/${s.file}`);
      if (!res.ok) throw new Error(`Failed to load sample (${res.status})`);
      const blob = await res.blob();
      pickFile(new File([blob], s.file, { type: blob.type || "image/png" }));
    } catch {
      setFormError("Could not load the sample label. Please try again.");
      setState("error");
    }
  }

  const exportBase = (file?.name ?? "label").replace(/\.[^.]+$/, "");
  function onDownloadJson() {
    if (!response) return;
    downloadJson(`${exportBase}.json`, {
      filename: file?.name,
      provider: response.provider,
      extracted: response.extracted,
      ...(response.result ? { result: response.result } : {}),
    });
  }
  function onDownloadCsv() {
    if (!response) return;
    downloadCsv(
      `${exportBase}.csv`,
      analysisToCsv([
        { filename: file?.name ?? "label", extracted: response.extracted, result: response.result },
      ]),
    );
  }

  const readable = state === "done" && response?.readable;

  return (
    <section
      aria-labelledby={`${ids.formErr}-h`}
      aria-busy={state === "loading"}
      className="rounded-card border border-border border-t-4 border-t-brand-600 bg-surface p-6 shadow-card sm:p-8"
    >
      <h2 id={`${ids.formErr}-h`} className="text-xl font-semibold text-ink">
        Read a label
      </h2>
      <p className="mt-1 text-ink-muted">
        Drop in a label image and the AI reads it automatically — no typing. Export the result as JSON
        or CSV. Want a compliance check too? Verify it against an application below (optional).
      </p>

      {/* One-click sample labels — real images the AI reads live. */}
      <div className="mt-4 rounded-card border border-border bg-surface-muted p-4">
        <p className="text-sm font-semibold text-ink">No image handy? Try a bundled sample:</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.file}
              type="button"
              onClick={() => void loadSample(s)}
              disabled={state === "loading"}
              className="inline-flex min-h-[44px] items-center rounded-pill border-2 border-border-strong bg-surface px-4 text-sm font-semibold text-ink transition hover:border-brand-600 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Image input — selecting it auto-reads the label. */}
      <div className="mt-6">
        <span className="mb-1.5 block font-medium text-ink">
          Label image <span className="font-normal text-ink-muted">(required)</span>
        </span>
        <DropZone
          id={ids.image}
          file={file}
          preview={preview}
          onFile={pickFile}
          inputRef={fileInputRef}
          describedById={ids.imageErr}
        />
        <p id={ids.imageErr} className="sr-only">
          Choose the photo of the alcohol label you want to read.
        </p>
      </div>

      {formError && (
        <div className="mt-5">
          <ErrorAlert id={ids.formErr}>{formError}</ErrorAlert>
        </div>
      )}

      {state === "loading" && (
        <>
          <p role="status" aria-live="polite" className="sr-only">
            Reading the label…
          </p>
          <div className="mt-2 flex items-center gap-2 text-ink-muted">
            <IconSpinner className="h-5 w-5 motion-safe:animate-spin" /> Reading the label…
          </div>
          <ResultSkeleton />
        </>
      )}

      {readable && response && (
        <>
          <ExtractedFieldsView extracted={response.extracted} headingRef={resultHeadingRef} />

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={onDownloadJson} className={secondaryButtonClass}>
              Download JSON
            </button>
            <button type="button" onClick={onDownloadCsv} className={secondaryButtonClass}>
              Download CSV
            </button>
          </div>

          <details className="mt-6 rounded-card border border-border bg-surface-muted p-4">
            <summary className="cursor-pointer font-semibold text-ink">
              Verify against an application (optional)
            </summary>
            <p className="mt-2 text-sm text-ink-muted">
              Enter what the application claims; the tool checks the label against it and shows a
              per-field verdict. Brand and alcohol content drive the check.
            </p>
            <form onSubmit={onVerify} noValidate className="mt-4 flex flex-col gap-4">
              <FormField label="Brand name" htmlFor={ids.brand}>
                <input id={ids.brand} type="text" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Old Tom Distillery" className={inputClass} />
              </FormField>
              <FormField label="Alcohol content" htmlFor={ids.alcohol}>
                <input id={ids.alcohol} type="text" value={alcohol} onChange={(e) => setAlcohol(e.target.value)} placeholder="e.g. 45% Alc./Vol. (90 Proof)" className={inputClass} />
              </FormField>
              <FormField label="Class / type" htmlFor={ids.classType}>
                <input id={ids.classType} type="text" value={classType} onChange={(e) => setClassType(e.target.value)} placeholder="e.g. Distilled spirits" className={inputClass} />
              </FormField>
              <FormField label="Net contents" htmlFor={ids.netContents}>
                <input id={ids.netContents} type="text" value={netContents} onChange={(e) => setNetContents(e.target.value)} placeholder="e.g. 750 mL" className={inputClass} />
              </FormField>
              <button type="submit" className={primaryButtonClass}>
                Verify against application
              </button>
            </form>
          </details>

          {response.result && <ResultView result={response.result} />}
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
