"use client";

/**
 * VerifyForm — the single "verify a label" screen (the spec's core loop).
 *
 * Drop a product's label image(s) — front, back, neck — and the AI reads them TOGETHER into one
 * structured record. The screen ALWAYS runs the deterministic TTB completeness check; when the agent
 * also enters the application's claimed values (brand + alcohol content), it LEADS with the
 * label-vs-application comparison — "Brand matches? ABV correct? Government warning there?" → Approve
 * / Needs review / Reject — gated on completeness. No typing required to read. Accessibility
 * (WCAG 2.1 AA): labelled controls, >=44px targets, visible focus, aria-live result regions, focus
 * moved to the result heading.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { VerifyApiResponse, VerifyApiError } from "./api/verify/contract";
import type { LabelPosition } from "@/extraction";
import { combinedVerdict, toClaimedFields, type CombinedVerdict } from "@/compare";
import type { ClaimedFields } from "@/domain";
import { ExtractedFieldsView } from "./ui/ExtractedFieldsView";
import { CompletenessView } from "./ui/CompletenessView";
import { ResultView } from "./ui/ResultView";
import { downscaleForUpload } from "./imageDownscale";
import { DropZone } from "./ui/DropZone";
import { ErrorAlert } from "./ui/ErrorAlert";
import { ResultSkeleton } from "./ui/ResultSkeleton";
import { inputClass, secondaryButtonClass } from "./ui/fieldStyles";
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
  // The application values the label is verified AGAINST — the reference the tool exists to check.
  // Brand + alcohol are required to produce a verdict; the rest are compared when the application
  // lists them. These persist across re-reads of the same product (no retyping).
  const [claimBrand, setClaimBrand] = useState("");
  const [claimAlcohol, setClaimAlcohol] = useState("");
  const [claimClass, setClaimClass] = useState("");
  const [claimNet, setClaimNet] = useState("");
  const [claimName, setClaimName] = useState("");
  const [claimAddress, setClaimAddress] = useState("");
  const [claimCountry, setClaimCountry] = useState("");
  // The image currently shown full-size in the lightbox, if any.
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  const ids = {
    image: useId(),
    imageHelp: useId(),
    err: useId(),
    heading: useId(),
    appBrand: useId(),
    appAlcohol: useId(),
    appClass: useId(),
    appNet: useId(),
    appName: useId(),
    appAddress: useId(),
    appCountry: useId(),
  };
  // One result heading owns focus after a read; only one result branch mounts at a time, so a single
  // ref attached to whichever headline renders (comparison / completeness / unreadable) is enough.
  const headlineRef = useRef<HTMLHeadingElement>(null);
  // Monotonic token so an in-flight read whose image set has since changed is ignored.
  const readToken = useRef(0);

  // When a read completes, move focus to the result heading so a keyboard/screen-reader user lands on
  // the headline outcome. Keyed on `state` only so live recompute (typing application values) never
  // steals focus.
  useEffect(() => {
    if (state !== "done") return;
    headlineRef.current?.focus();
  }, [state]);

  const readable = state === "done" && Boolean(response?.readable);

  // The application values, or null when not enough is entered to compare (needs BOTH brand AND
  // alcohol — toClaimedFields owns that rule, shared with the batch screen).
  const claimed: ClaimedFields | null = useMemo(
    () =>
      toClaimedFields({
        brand: claimBrand,
        alcoholContentText: claimAlcohol,
        classType: claimClass,
        netContents: claimNet,
        name: claimName,
        address: claimAddress,
        countryOfOrigin: claimCountry,
      }),
    [claimBrand, claimAlcohol, claimClass, claimNet, claimName, claimAddress, claimCountry],
  );

  // Always compute completeness (the law-based headline when nothing is being compared); the
  // claimed-vs-label comparison rides on top when application values are supplied. Pure + client-side,
  // so typing application values recomputes instantly with no re-read.
  const combined: CombinedVerdict | null = useMemo(
    () => (readable && response ? combinedVerdict(claimed, response.extracted) : null),
    [readable, response, claimed],
  );

  // Read the current image set (front/back/...) together. Triggered from the handlers, not an effect,
  // so the AI reads automatically the moment images change — with no manual "go" button.
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
    if (!response || !combined) return;
    downloadJson(`${exportBase}.json`, {
      images: orderedImages.map((i) => ({ filename: i.file.name, position: i.position })),
      provider: response.provider,
      extracted: response.extracted,
      completeness: combined.completeness,
      ...(claimed ? { claimed } : {}),
      ...(combined.verify
        ? { result: combined.verify, overall: combined.overall }
        : {}),
    });
  }
  function onDownloadCsv() {
    if (!response || !combined) return;
    downloadCsv(`${exportBase}.csv`, analysisToCsv([
      {
        filename: exportBase,
        extracted: response.extracted,
        completeness: combined.completeness,
        result: combined.verify,
        overall: combined.overall ?? undefined,
      },
    ]));
  }

  // The headline outcome announced in the live region. When the application hasn't been entered yet,
  // the screen is awaiting it (not presenting completeness as the answer), so announce that.
  const announce = combined
    ? combined.verify
      ? `Verdict: ${VERDICT_LABEL[combined.overall ?? "review"]}.`
      : "Label read. Enter the application's brand and alcohol content to verify it."
    : "";

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
        Upload the product&apos;s front label (and the back, if you have it) — the AI reads it — then
        enter what the application claims. The screen checks the label against the application
        field-by-field (brand, alcohol, net contents, producer, origin) and the statutory government
        warning, and flags every mismatch as Approve / Needs review / Reject.
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

      {/* Step 2 — the application: the reference the label is verified against. Brand + alcohol are
          REQUIRED to produce a verdict; the rest are compared when the application lists them. The
          verdict recomputes live as the agent types — no re-read. */}
      <div className="mt-6">
        <h3 className="mb-1.5 block font-medium text-ink">2. The application</h3>
        <p className="mb-3 text-sm text-ink-muted">
          Enter what the application claims — the label is checked against it using the TTB rules
          (brand match, ABV tolerance by class, verbatim warning). <strong className="text-ink">Brand
          and alcohol content are required</strong> for a verdict; fill the rest if the application
          lists them.
        </p>

        {/* The two values that unlock the verdict */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.appBrand} className="mb-1.5 block text-sm font-medium text-ink">
              Brand <span className="text-fail-700" aria-hidden="true">*</span>{" "}
              <span className="font-normal text-ink-muted">(required)</span>
            </label>
            <input
              id={ids.appBrand}
              type="text"
              required
              aria-required="true"
              value={claimBrand}
              onChange={(e) => setClaimBrand(e.target.value)}
              placeholder="e.g. ABC Single Barrel"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={ids.appAlcohol} className="mb-1.5 block text-sm font-medium text-ink">
              Alcohol content <span className="text-fail-700" aria-hidden="true">*</span>{" "}
              <span className="font-normal text-ink-muted">(required)</span>
            </label>
            <input
              id={ids.appAlcohol}
              type="text"
              required
              aria-required="true"
              value={claimAlcohol}
              onChange={(e) => setClaimAlcohol(e.target.value)}
              placeholder="e.g. 45% Alc./Vol."
              className={inputClass}
            />
          </div>
        </div>

        {/* Compared only when the application lists them */}
        <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Other application values — fill if the application lists them
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { id: ids.appClass, label: "Class / type", value: claimClass, set: setClaimClass, ph: "e.g. Straight Rye Whisky" },
            { id: ids.appNet, label: "Net contents", value: claimNet, set: setClaimNet, ph: "e.g. 750 mL" },
            { id: ids.appName, label: "Producer / bottler name", value: claimName, set: setClaimName, ph: "e.g. ABC Distillery" },
            { id: ids.appAddress, label: "Producer / bottler address", value: claimAddress, set: setClaimAddress, ph: "e.g. Frederick, MD" },
            { id: ids.appCountry, label: "Country of origin", value: claimCountry, set: setClaimCountry, ph: "e.g. Product of Scotland", hint: "imports only" },
          ].map((f) => (
            <div key={f.id}>
              <label htmlFor={f.id} className="mb-1.5 block text-sm font-medium text-ink">
                {f.label}
                {f.hint ? <span className="font-normal text-ink-muted"> ({f.hint})</span> : null}
              </label>
              <input
                id={f.id}
                type="text"
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                placeholder={f.ph}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Persistent live region: the headline can appear/refresh reactively as the agent types the
          application values (no `state` change), so the focus-move announcement never fires there.
          This polite region announces the headline outcome whenever it appears or changes. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
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

      {/* Results — the headline IS the label-vs-application comparison. Until the application's brand +
          alcohol are entered, the screen says so (it never presents the completeness check as the
          answer); completeness is a supporting check behind a disclosure either way. */}
      {readable && response && combined && (
        <>
          {combined.verify ? (
            <>
              <ResultView
                result={combined.verify}
                overall={combined.overall ?? undefined}
                gatedByCompleteness={combined.gatedByCompleteness}
                headingRef={headlineRef}
              />
              <details className="mt-6 rounded-card border border-border bg-surface-muted p-4">
                <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
                  Supporting check: TTB completeness
                </summary>
                <CompletenessView completeness={combined.completeness} />
              </details>
            </>
          ) : (
            <section aria-label="Awaiting the application" className="mt-6 flex flex-col gap-4">
              <div className="flex items-start gap-4 rounded-card border-l-8 border-brand-600 bg-brand-50 p-5 shadow-card">
                <IconReview className="h-9 w-9 shrink-0 text-brand-700" />
                <div>
                  <h2
                    ref={headlineRef}
                    tabIndex={-1}
                    className="text-lg font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                  >
                    Enter the application to verify
                  </h2>
                  <p className="mt-1 text-sm text-ink">
                    The label was read. Add the application&apos;s <strong>brand</strong> and{" "}
                    <strong>alcohol content</strong> above to check the label against it.
                  </p>
                </div>
              </div>
              <details className="rounded-card border border-border bg-surface-muted p-4">
                <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
                  Supporting check: TTB completeness
                </summary>
                <CompletenessView completeness={combined.completeness} />
              </details>
            </section>
          )}
          <details className="mt-4 rounded-card border border-border bg-surface-muted p-4">
            <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
              What the AI read off the label
            </summary>
            <ExtractedFieldsView extracted={response.extracted} />
          </details>
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
            ref={headlineRef}
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
