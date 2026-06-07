"use client";

/**
 * VerifyForm — the single, accessible upload screen (US-006).
 *
 * Drag-and-drop OR file picker for the label image (with a live preview), labeled inputs for the
 * claimed values, and one-click sample labels so a reviewer can see a real verdict instantly.
 * Accessibility (WCAG 2.1 AA): every control has an associated label, required fields use
 * aria-required + errors linked via aria-describedby, controls are >=44px tall, focus is always
 * visible, one primary Verify button, and focus moves to the result heading on completion.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { VerifyApiResponse, VerifyApiError } from "./api/verify/contract";
import { ResultView } from "./ResultView";
import { downscaleForUpload } from "./imageDownscale";
import { DropZone } from "./ui/DropZone";
import { FormField } from "./ui/FormField";
import { ErrorAlert } from "./ui/ErrorAlert";
import { ResultSkeleton } from "./ui/ResultSkeleton";
import { inputClass, primaryButtonClass } from "./ui/fieldStyles";
import { toneForStatus, TONE_SOLID } from "./ui/status";
import { IconReview, IconSpinner } from "./ui/icons";

type SubmitState = "idle" | "loading" | "done" | "error";

interface Claims {
  brand: string;
  alcohol: string;
  classType: string;
  netContents: string;
}

/** Bundled sample labels (served from /public/samples) — REAL readable rasters for the live demo;
 *  the offline mock also keys off the filename, so each yields a real verdict with no keys. */
const SAMPLES: ReadonlyArray<{ file: string; label: string; outcome: string } & Claims> = [
  {
    file: "demo-old-tom-clean.png",
    label: "Clean label",
    outcome: "Approve",
    brand: "OLD TOM DISTILLERY",
    alcohol: "45% Alc./Vol. (90 Proof)",
    classType: "distilled-spirits",
    netContents: "750 mL",
  },
  {
    file: "demo-warning-title-case.png",
    label: "Title-case warning",
    outcome: "Reject",
    brand: "OLD TOM DISTILLERY",
    alcohol: "45% Alc./Vol. (90 Proof)",
    classType: "distilled-spirits",
    netContents: "750 mL",
  },
  {
    file: "demo-brand-typo.png",
    label: "Brand typo",
    outcome: "Review",
    brand: "Old Tom Distillery",
    alcohol: "45% Alc./Vol. (90 Proof)",
    classType: "distilled-spirits",
    netContents: "750 mL",
  },
  {
    file: "abc-single-barrel-clean.jpg",
    label: "Real photo (ABC Rye)",
    outcome: "Approve",
    brand: "ABC",
    alcohol: "45% Alc./Vol.",
    classType: "distilled-spirits",
    netContents: "750 mL",
  },
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
  const [result, setResult] = useState<VerifyApiResponse | null>(null);

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

  // Move focus to the result heading once a verdict is in (it is also an aria-live region).
  useEffect(() => {
    if (state === "done") resultHeadingRef.current?.focus();
  }, [state]);

  // Revoke the object URL when the preview changes or the component unmounts (no leaks).
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function pickFile(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function submitVerification(f: File, c: Claims) {
    setState("loading");
    try {
      // Shrink large photos before upload to cut latency/cost (no-op for the vector samples and
      // already-small images; falls back to the original on any failure). Preview keeps the original.
      const uploadFile = await downscaleForUpload(f);
      const body = new FormData();
      body.set("image", uploadFile);
      body.set("brand", c.brand);
      body.set("alcoholContent", c.alcohol);
      body.set("classType", c.classType);
      body.set("netContents", c.netContents);
      const res = await fetch("/api/verify", { method: "POST", body });
      const json: VerifyApiResponse | VerifyApiError = await res.json();
      if (!res.ok) {
        setFormError((json as VerifyApiError).error || "Verification failed.");
        setState("error");
        return;
      }
      setResult(json as VerifyApiResponse);
      setState("done");
    } catch {
      setFormError("Could not reach the verifier. Please try again.");
      setState("error");
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    if (!file) {
      setFormError("Please choose a label image to verify (or try a sample below).");
      fileInputRef.current?.focus();
      return;
    }
    if (!brand.trim() || !alcohol.trim()) {
      setFormError("Brand name and alcohol content are both required.");
      return;
    }
    await submitVerification(file, { brand, alcohol, classType, netContents });
  }

  async function loadSample(s: (typeof SAMPLES)[number]) {
    setFormError(null);
    try {
      const res = await fetch(`/samples/${s.file}`);
      if (!res.ok) throw new Error(`Failed to load sample (${res.status})`);
      const blob = await res.blob();
      const f = new File([blob], s.file, { type: blob.type || "image/png" });
      pickFile(f);
      setBrand(s.brand);
      setAlcohol(s.alcohol);
      setClassType(s.classType);
      setNetContents(s.netContents);
      await submitVerification(f, {
        brand: s.brand,
        alcohol: s.alcohol,
        classType: s.classType,
        netContents: s.netContents,
      });
    } catch {
      setFormError("Could not load the sample label. Please try again.");
      setState("error");
    }
  }

  return (
    <section
      aria-labelledby={`${ids.formErr}-h`}
      aria-busy={state === "loading"}
      className="rounded-card border border-border border-t-4 border-t-brand-600 bg-surface p-6 shadow-card sm:p-8"
    >
      <h2 id={`${ids.formErr}-h`} className="text-xl font-semibold text-ink">
        Verify a label
      </h2>

      {/* One-click sample labels — instant real verdicts (offline mock keys off the filename). */}
      <div className="mt-4 rounded-card border border-border bg-surface-muted p-4">
        <p className="text-sm font-semibold text-ink">No image handy? Try a bundled sample label:</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {SAMPLES.map((s) => {
            const tone = toneForStatus(s.outcome.toLowerCase());
            return (
              <button
                key={s.file}
                type="button"
                onClick={() => void loadSample(s)}
                disabled={state === "loading"}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-pill border-2 border-border-strong bg-surface px-4 text-sm font-semibold text-ink transition hover:border-brand-600 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {s.label}
                <span className={`rounded-pill px-2 py-0.5 text-xs font-bold ${TONE_SOLID[tone]}`}>
                  {s.outcome}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          These bundled labels read offline with no keys. Configure Azure OpenAI to verify your own
          photos — see the README.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
        <div>
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
            Choose the photo of the alcohol label you want to verify.
          </p>
        </div>

        <FormField label="Brand name" htmlFor={ids.brand} required>
          <input
            id={ids.brand}
            name="brand"
            type="text"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            aria-required="true"
            placeholder="e.g. Old Tom Distillery"
            className={inputClass}
          />
        </FormField>

        <FormField label="Alcohol content" htmlFor={ids.alcohol} required>
          <input
            id={ids.alcohol}
            name="alcoholContent"
            type="text"
            value={alcohol}
            onChange={(e) => setAlcohol(e.target.value)}
            aria-required="true"
            placeholder="e.g. 45% Alc./Vol. (90 Proof)"
            className={inputClass}
          />
        </FormField>

        <FormField label="Class / type" htmlFor={ids.classType}>
          <input
            id={ids.classType}
            name="classType"
            type="text"
            value={classType}
            onChange={(e) => setClassType(e.target.value)}
            placeholder="e.g. Distilled spirits, Table wine, India Pale Ale"
            className={inputClass}
          />
        </FormField>

        <FormField label="Net contents" htmlFor={ids.netContents}>
          <input
            id={ids.netContents}
            name="netContents"
            type="text"
            value={netContents}
            onChange={(e) => setNetContents(e.target.value)}
            placeholder="e.g. 750 mL"
            className={inputClass}
          />
        </FormField>

        {formError && <ErrorAlert id={ids.formErr}>{formError}</ErrorAlert>}

        <button
          type="submit"
          disabled={state === "loading"}
          aria-describedby={formError ? ids.formErr : undefined}
          className={`${primaryButtonClass} text-lg`}
        >
          {state === "loading" ? (
            <>
              <IconSpinner className="h-5 w-5 motion-safe:animate-spin" /> Verifying…
            </>
          ) : (
            "Verify label"
          )}
        </button>
      </form>

      {state === "loading" && (
        <>
          <p role="status" aria-live="polite" className="sr-only">
            Verifying label…
          </p>
          <ResultSkeleton />
        </>
      )}

      {state === "done" && result?.readable && result.result && (
        <ResultView result={result.result} headingRef={resultHeadingRef} />
      )}

      {state === "done" && result && !result.readable && (
        <section
          role="alert"
          className="mt-6 rounded-card border-l-8 border-review-500 bg-review-50 p-5 shadow-card"
        >
          <h2
            ref={resultHeadingRef}
            tabIndex={-1}
            className="flex items-center gap-2 text-lg font-semibold text-review-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            <IconReview className="h-6 w-6 shrink-0" /> Couldn&apos;t read the label
          </h2>
          <p className="mt-2 text-review-900">{result.message ?? "Please re-upload a clearer photo."}</p>
        </section>
      )}
    </section>
  );
}
