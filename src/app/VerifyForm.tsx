"use client";

/**
 * VerifyForm — the single, accessible upload screen (US-006).
 *
 * Drag-and-drop OR file picker for the label image (with a live preview), labeled inputs for the
 * claimed values, and one-click sample labels so a reviewer can see a real verdict instantly
 * (the offline mock recognizes the bundled samples by filename). Accessibility (WCAG 2.1 AA):
 * every control has an associated label, required fields use aria-required + errors linked via
 * aria-describedby, controls are >=44px tall, focus is always visible, one primary Verify button.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import type { VerifyApiResponse, VerifyApiError } from "./api/verify/contract";
import { ResultView } from "./ResultView";

type SubmitState = "idle" | "loading" | "done" | "error";

interface Claims {
  brand: string;
  alcohol: string;
  classType: string;
  netContents: string;
}

/** Bundled sample labels (served from /public/samples) — the offline mock keys off the filename,
 *  so clicking one loads its image + claimed values and produces a real verdict with no keys. */
const SAMPLES: ReadonlyArray<{ file: string; label: string; outcome: string } & Claims> = [
  {
    file: "old-tom-bourbon-clean.svg",
    label: "Clean label",
    outcome: "Approve",
    brand: "OLD TOM DISTILLERY",
    alcohol: "45% Alc./Vol. (90 Proof)",
    classType: "distilled-spirits",
    netContents: "750 mL",
  },
  {
    file: "warning-title-case.svg",
    label: "Title-case warning",
    outcome: "Reject",
    brand: "OLD TOM DISTILLERY",
    alcohol: "45% Alc./Vol. (90 Proof)",
    classType: "distilled-spirits",
    netContents: "750 mL",
  },
  {
    file: "brand-typo-review.svg",
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

  const [dragOver, setDragOver] = useState(false);
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

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0]);
  }
  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    pickFile(e.target.files?.[0]);
  }

  async function submitVerification(f: File, c: Claims) {
    setState("loading");
    try {
      const body = new FormData();
      body.set("image", f);
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
      const f = new File([blob], s.file, { type: blob.type || "image/svg+xml" });
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

  const inputClass =
    "min-h-[44px] w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2 text-slate-900 " +
    "placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-blue-700 focus-visible:ring-offset-2";

  return (
    <section aria-labelledby={`${ids.formErr}-h`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 id={`${ids.formErr}-h`} className="text-xl font-semibold text-slate-900">
        Verify a label
      </h2>

      {/* One-click sample labels — instant real verdicts with no keys (offline mock). */}
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-800">
          No image handy? Try a bundled sample label:
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.file}
              type="button"
              onClick={() => void loadSample(s)}
              disabled={state === "loading"}
              className="min-h-[40px] rounded-full border-2 border-blue-700 px-3 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {s.label} → {s.outcome}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Demo (mock) mode reads these bundled labels offline. To verify your own photos, configure a
          real provider — see the README.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-5">
        {/* Image upload: drag-and-drop wrapping a real (keyboard-focusable) file input, with preview */}
        <div>
          <span className="mb-1 block font-medium text-slate-800">Label image (required)</span>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={onDrop}
            className={
              "rounded-xl border-2 border-dashed p-6 text-center transition-colors " +
              "focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-700 focus-within:ring-offset-2 " +
              (dragOver ? "border-blue-700 bg-blue-50" : "border-slate-400 bg-slate-50")
            }
          >
            <label htmlFor={ids.image} className="flex cursor-pointer flex-col items-center gap-1">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a remote asset
                <img
                  src={preview}
                  alt={file ? `Preview of ${file.name}` : "Selected label preview"}
                  className="mx-auto mb-3 max-h-56 w-auto rounded border border-slate-300 bg-white object-contain"
                />
              )}
              <span className="font-medium text-slate-900">
                {file ? `Selected: ${file.name}` : "Drag & drop a label image here"}
              </span>
              <span className="text-sm text-slate-600">
                or <span className="font-semibold text-blue-700 underline">browse for a file</span>
              </span>
              <input
                ref={fileInputRef}
                id={ids.image}
                name="image"
                type="file"
                accept="image/*"
                onChange={onFileChange}
                aria-required="true"
                aria-describedby={ids.imageErr}
                className="sr-only"
              />
            </label>
          </div>
          <p id={ids.imageErr} className="sr-only">
            Choose the photo of the alcohol label you want to verify.
          </p>
        </div>

        <div>
          <label htmlFor={ids.brand} className="mb-1 block font-medium text-slate-800">
            Brand name (required)
          </label>
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
        </div>

        <div>
          <label htmlFor={ids.alcohol} className="mb-1 block font-medium text-slate-800">
            Alcohol content (required)
          </label>
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
        </div>

        <div>
          <label htmlFor={ids.classType} className="mb-1 block font-medium text-slate-800">
            Class / type (optional)
          </label>
          <input
            id={ids.classType}
            name="classType"
            type="text"
            value={classType}
            onChange={(e) => setClassType(e.target.value)}
            placeholder="e.g. Distilled spirits, Table wine, India Pale Ale"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={ids.netContents} className="mb-1 block font-medium text-slate-800">
            Net contents (optional)
          </label>
          <input
            id={ids.netContents}
            name="netContents"
            type="text"
            value={netContents}
            onChange={(e) => setNetContents(e.target.value)}
            placeholder="e.g. 750 mL"
            className={inputClass}
          />
        </div>

        {formError && (
          <p
            id={ids.formErr}
            role="alert"
            className="rounded-lg border-2 border-red-700 bg-red-50 px-3 py-2 font-medium text-red-800"
          >
            <span aria-hidden="true">⚠ </span>
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={state === "loading"}
          aria-describedby={formError ? ids.formErr : undefined}
          className="min-h-[48px] rounded-lg bg-blue-700 px-6 text-lg font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {state === "loading" ? "Verifying…" : "Verify"}
        </button>
      </form>

      {state === "done" && result?.readable && result.result && (
        <ResultView result={result.result} headingRef={resultHeadingRef} />
      )}

      {state === "done" && result && !result.readable && (
        <section
          role="alert"
          className="mt-6 rounded-xl border-l-8 border-amber-500 bg-amber-50 p-4"
        >
          <h2
            ref={resultHeadingRef}
            tabIndex={-1}
            className="text-lg font-semibold text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            <span aria-hidden="true">⚠ </span>Couldn&apos;t read the label
          </h2>
          <p className="mt-2 text-amber-900">
            {result.message ?? "Please re-upload a clearer photo."}
          </p>
        </section>
      )}
    </section>
  );
}
