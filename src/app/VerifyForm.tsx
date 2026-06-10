"use client";

/**
 * VerifyForm — the single "verify a label" screen (the spec's core loop).
 *
 * Drop a product's label image(s) — front, back — and the AI reads them TOGETHER into one structured
 * record. The screen ALWAYS runs the deterministic TTB completeness check; the agent then confirms the
 * application's values (the AI's reading is SUGGESTED in grey — Tab or "Accept all" to accept), and the
 * screen LEADS with the label-vs-application comparison once every field TTB REQUIRES for the beverage
 * type is supplied. The required set is DYNAMIC per type (requiredInputKeysFor, from the CFR matrix):
 * spirits/wine>14%/unknown require alcohol; wine≤14%/malt/cider don't. Accessibility (WCAG 2.1 AA):
 * labelled controls, >=44px targets, visible focus, aria-live result regions, focus moved to the result.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { VerifyApiResponse, VerifyApiError } from "./api/verify/contract";
import type { LabelPosition } from "@/extraction";
import {
  combinedVerdict,
  resolveBeverageClass,
  parseAlcoholText,
  requiredInputKeysFor,
  classChoiceFor,
  CLASS_CHOICES,
  FIELD_REVIEW_CONFIDENCE,
  type ClassChoice,
  type CombinedVerdict,
  type VerifyFieldKey,
} from "@/compare";
import type { BeverageClass, ClaimedFields, RequirementKey } from "@/domain";
import { ExtractedFieldsView } from "./ui/ExtractedFieldsView";
import { CompletenessView } from "./ui/CompletenessView";
import { ResultView, type FieldOverride } from "./ui/ResultView";
import { deriveLabelReview, toggleOverride, setFieldNote, type FieldNotes } from "./ui/labelReview";
import { DecisionPanel } from "./ui/DecisionPanel";
import { PipelineSteps } from "./ui/PipelineSteps";
import { CLASS_DISPLAY_LABEL } from "./ui/beverageClass";
import { downscaleForUpload } from "./imageDownscale";
import { DropZone } from "./ui/DropZone";
import { FieldHelp } from "./ui/FieldHelp";
import { APP_FIELD_HELP, type AppInputKey } from "./ui/fieldHelpCopy";
import { ErrorAlert } from "./ui/ErrorAlert";
import { ResultSkeleton } from "./ui/ResultSkeleton";
import { inputClass, linkClass, secondaryButtonClass } from "./ui/fieldStyles";
import { downloadJson, downloadCsv } from "./ui/download";
import { analysisToCsv } from "@/batch/csv";
import { ImageLightbox } from "./ui/ImageLightbox";
import { ForwardLookingNote } from "./ui/ForwardLookingNote";
import { VERDICT_LABEL } from "./ui/status";
import { IconReview, IconSpinner, IconZoom, IconPass } from "./ui/icons";

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

/** Human label for each application input / requirement key (used by the "still needed" checklist). */
const KEY_LABEL: Record<RequirementKey, string> = {
  brand: "Brand name",
  classType: "Class / type",
  alcoholContent: "Alcohol content",
  netContents: "Net contents",
  name: "Producer / bottler name",
  address: "Producer / bottler address",
  governmentWarning: "Government warning",
  countryOfOrigin: "Country of origin",
  sulfiteDeclaration: "Sulfite declaration",
  ageStatement: "Age statement",
  appellation: "Appellation of origin",
  statementOfComposition: "Statement of composition",
};

/** The amber input treatment for a LOW-CONFIDENCE AI suggestion — the agent should scrutinise it
 *  before accepting. Distinct from inputClass so the "yellow highlight" is unmistakable. */
const LOW_CONF_INPUT =
  "min-h-[44px] w-full rounded-field border-2 border-review-500 bg-review-50 px-3 py-2.5 text-ink " +
  "placeholder:text-review-700 shadow-sm transition focus-visible:outline-none focus-visible:border-brand-600 " +
  "focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function VerifyForm({ mockMode = false }: { mockMode?: boolean }) {
  // The label is uploaded into two explicit slots — Front (required) and Back (optional) — so the
  // agent says what each image is; position is fixed by the slot (no order-guessing, no dropdown).
  const [slots, setSlots] = useState<{ front?: LabelImage; back?: LabelImage }>({});
  const [state, setState] = useState<SubmitState>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [response, setResponse] = useState<VerifyApiResponse | null>(null);
  // The application values the label is verified AGAINST. These persist across re-reads (no retyping).
  const [claimBrand, setClaimBrand] = useState("");
  const [claimAlcohol, setClaimAlcohol] = useState("");
  const [claimClass, setClaimClass] = useState("");
  const [claimNet, setClaimNet] = useState("");
  const [claimName, setClaimName] = useState("");
  const [claimAddress, setClaimAddress] = useState("");
  const [claimCountry, setClaimCountry] = useState("");
  const [claimFanciful, setClaimFanciful] = useState("");
  const [claimSoc, setClaimSoc] = useState("");
  // The beverage type the required-field set is driven by. null = use the AI's reading; a value = the
  // agent overrode it. The wine ≤14/>14 split is derived from ABV, never a human pick.
  const [classChoice, setClassChoice] = useState<ClassChoice | null>(null);
  // The reviewer's per-field decisions over the AI verdict: "ok" confirms a flagged field, "issue"
  // flags one the AI passed. The headline recomputes from these (cleared on every fresh read).
  const [fieldOverrides, setFieldOverrides] = useState<Partial<Record<VerifyFieldKey, FieldOverride>>>({});
  function setOverride(key: VerifyFieldKey, value: FieldOverride | undefined) {
    setFieldOverrides((prev) => toggleOverride(prev, key, value));
  }
  // A free-text note the reviewer can leave when confirming/flagging a field (why / what was checked).
  // It feeds the applicant-email notes. Cleared on every fresh read alongside the overrides.
  const [fieldNotes, setFieldNotes] = useState<FieldNotes>({});
  function setNote(key: VerifyFieldKey, text: string) {
    setFieldNotes((prev) => setFieldNote(prev, key, text));
  }
  // The application inputs persist across a re-read of the SAME label (no retyping). But when the FRONT
  // label is removed/replaced the product itself is changing, so the old typed application + beverage-type
  // override must be dropped — otherwise the new image is verified against the previous product's values
  // ("stuck on the last image"). Also drop which suggestions were dismissed (see editedInputs).
  function resetApplication() {
    setClaimBrand("");
    setClaimAlcohol("");
    setClaimClass("");
    setClaimNet("");
    setClaimName("");
    setClaimAddress("");
    setClaimCountry("");
    setClaimFanciful("");
    setClaimSoc("");
    setClassChoice(null);
    setEditedInputs(new Set());
  }
  // Inputs the agent has explicitly edited/cleared. A touched suggestion must NOT be re-injected by
  // Tab-to-accept, so a low-confidence field a reviewer wants to leave blank stays blank (once touched it
  // stays "edited" for this read; a fresh read clears the whole set).
  const [editedInputs, setEditedInputs] = useState<Set<string>>(new Set());
  function markEdited(id: string) {
    setEditedInputs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }
  // The image currently shown full-size in the lightbox, if any.
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  const ids = {
    image: useId(),
    imageHelp: useId(),
    err: useId(),
    heading: useId(),
    appType: useId(),
    appBrand: useId(),
    appAlcohol: useId(),
    appClass: useId(),
    appNet: useId(),
    appName: useId(),
    appAddress: useId(),
    appCountry: useId(),
    appFanciful: useId(),
    appSoc: useId(),
  };
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const readToken = useRef(0);

  useEffect(() => {
    if (state !== "done") return;
    headlineRef.current?.focus();
  }, [state]);

  const readable = state === "done" && Boolean(response?.readable);
  const extracted = readable && response ? response.extracted : undefined;

  // The AI's per-field suggestion + confidence, and which application input it maps to. The required
  // set is dynamic (below), so each input is rendered uniformly and marked required per the resolved type.
  const appInputs: {
    key: AppInputKey;
    id: string;
    label: string;
    value: string;
    set: (v: string) => void;
    suggestion?: string;
    confidence?: number;
    hint?: string;
  }[] = [
    { key: "brand", id: ids.appBrand, label: "Brand name", value: claimBrand, set: setClaimBrand, suggestion: extracted?.brand, confidence: extracted?.confidence.brand },
    { key: "classType", id: ids.appClass, label: "Class / type", value: claimClass, set: setClaimClass, suggestion: extracted?.classType?.trim() ? extracted.classType : extracted?.class, confidence: extracted?.confidence.classType ?? extracted?.confidence.class },
    { key: "alcoholContent", id: ids.appAlcohol, label: "Alcohol content", value: claimAlcohol, set: setClaimAlcohol, suggestion: extracted?.alcoholContentText, confidence: extracted?.confidence.alcoholContent },
    { key: "netContents", id: ids.appNet, label: "Net contents", value: claimNet, set: setClaimNet, suggestion: extracted?.netContents, confidence: extracted?.confidence.netContents },
    { key: "name", id: ids.appName, label: "Producer / bottler name", value: claimName, set: setClaimName, suggestion: extracted?.name, confidence: extracted?.confidence.name },
    { key: "address", id: ids.appAddress, label: "Producer / bottler address", value: claimAddress, set: setClaimAddress, suggestion: extracted?.address, confidence: extracted?.confidence.address },
    { key: "countryOfOrigin", id: ids.appCountry, label: "Country of origin", value: claimCountry, set: setClaimCountry, suggestion: extracted?.countryOfOrigin, confidence: extracted?.confidence.countryOfOrigin, hint: "imports only" },
    { key: "fancifulName", id: ids.appFanciful, label: "Distinctive / fanciful name", value: claimFanciful, set: setClaimFanciful, suggestion: extracted?.fancifulName, confidence: extracted?.confidence.fancifulName, hint: "if any" },
    { key: "statementOfComposition", id: ids.appSoc, label: "Statement of composition", value: claimSoc, set: setClaimSoc, suggestion: extracted?.statementOfComposition, confidence: extracted?.confidence.statementOfComposition, hint: "specialties" },
  ];

  // Resolve the beverage class that DRIVES the required set: the agent's override wins, else the AI's
  // reading; the wine ≤14/>14 split uses the ABV (typed value preferred, else the label's).
  const aiClassText = extracted ? (extracted.classType?.trim() ? extracted.classType : extracted.class) : undefined;
  const effectiveAbv = parseAlcoholText(claimAlcohol).abv ?? parseAlcoholText(extracted?.alcoholContentText).abv;
  const beverageClass: BeverageClass = resolveBeverageClass(classChoice ?? aiClassText, effectiveAbv);
  const selectorChoice: ClassChoice = classChoice ?? classChoiceFor(beverageClass);

  // The dynamic required-input set for this type (brand/class/type/net/name/address always; alcohol only
  // where the law makes it mandatory), and which of those are still empty (block the verdict until none).
  const requiredKeys = extracted ? requiredInputKeysFor(beverageClass) : [];
  const valueByKey = (k: RequirementKey): string =>
    appInputs.find((f) => f.key === k)?.value ?? "";
  const missingKeys = requiredKeys.filter((k) => valueByKey(k).trim() === "");
  const applicationComplete = Boolean(extracted) && missingKeys.length === 0;

  // The application object, built only when every required field is supplied (else null → block).
  const opt = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);
  const claimed: ClaimedFields | null = applicationComplete
    ? {
        brand: claimBrand.trim(),
        alcoholContentText: claimAlcohol.trim() || undefined,
        classType: opt(claimClass),
        netContents: opt(claimNet),
        name: opt(claimName),
        address: opt(claimAddress),
        countryOfOrigin: opt(claimCountry),
        fancifulName: opt(claimFanciful),
        statementOfComposition: opt(claimSoc),
        beverageClass,
      }
    : null;

  // Completeness always runs (the law-based supporting check); the claimed-vs-label comparison rides on
  // top once the application is complete. Pure + client-side, so typing recomputes instantly (no re-read).
  const combined: CombinedVerdict | null = extracted ? combinedVerdict(claimed, extracted) : null;

  // The full human-in-the-loop review state (effective verdict after overrides, completeness gate +
  // concerns, applicant-email notes) — derived by the SAME shared function the batch worklist uses, so
  // the single screen and batch can't drift.
  const {
    effectiveOverall,
    effectiveGatedByCompleteness,
    completenessOverrides,
    completenessConcerns,
    approveNotes,
    rejectNotes,
  } = deriveLabelReview(combined, fieldOverrides, fieldNotes);

  // Accept the AI's grey suggestion for one field by pressing Tab while it's empty (the agent confirms
  // the read as the application value) — fast, but deliberate, so an unaccepted required field still blocks.
  function acceptOnTab(e: KeyboardEvent<HTMLInputElement>, id: string, value: string, suggestion: string | undefined, set: (v: string) => void) {
    // Only auto-accept an UNTOUCHED suggested field. Once the reviewer has edited/cleared it, Tab must
    // not force the (possibly wrong, low-confidence) suggestion back in — they can leave it blank or fix it.
    if (e.key === "Tab" && !e.shiftKey && value.trim() === "" && !editedInputs.has(id) && suggestion && suggestion.trim()) {
      set(suggestion.trim());
    }
  }
  // Fill every still-empty field that has a suggestion, in one click.
  function acceptAllSuggestions() {
    for (const f of appInputs) {
      if (f.value.trim() === "" && f.suggestion && f.suggestion.trim()) f.set(f.suggestion.trim());
    }
  }
  const hasUnacceptedSuggestions = appInputs.some((f) => f.value.trim() === "" && f.suggestion?.trim());

  async function read(imgs: LabelImage[]) {
    if (imgs.length === 0) return;
    const token = ++readToken.current;
    setState("loading");
    setFormError(null);
    setFieldOverrides({}); // a fresh read re-evaluates; drop the prior verdict's human overrides
    setFieldNotes({}); // and the notes that went with them
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

  // Side effects (the POST to /api/verify, object-URL create/revoke, sibling setState) stay OUTSIDE
  // the setSlots call: React Strict Mode double-invokes setState UPDATER functions in dev, so an
  // updater with a fetch inside fires every upload twice (doubled vision-API cost) and leaks one
  // object URL per upload. Updaters must be pure; the new state is computed from the current render.
  function setSlot(key: SlotKey, file: File) {
    const old = slots[key];
    if (old) {
      if (zoom?.src === old.preview) setZoom(null);
      URL.revokeObjectURL(old.preview);
    }
    const next = { ...slots, [key]: { file, preview: URL.createObjectURL(file), position: key as LabelPosition } };
    setSlots(next);
    void read(orderedImagesOf(next));
  }
  function clearSlot(key: SlotKey) {
    const target = slots[key];
    if (target) {
      if (zoom?.src === target.preview) setZoom(null);
      URL.revokeObjectURL(target.preview);
    }
    const next = { ...slots, [key]: undefined };
    setSlots(next);
    const imgs = orderedImagesOf(next);
    // Clearing the FRONT (the product anchor) or removing the last image starts a NEW product — drop the
    // typed application + beverage-type override so the next label isn't verified against the old one.
    // (The realistic "replace" is Remove + re-add, since a filled slot shows Remove, not a drop zone.)
    if (key === "front" || imgs.length === 0) resetApplication();
    if (imgs.length === 0) {
      readToken.current++; // cancel any in-flight read
      setState("idle");
      setResponse(null);
      setFormError(null); // no images -> nothing to retry; a leftover error banner would be unactionable
    } else {
      void read(imgs);
    }
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
        ? {
            result: combined.verify,
            overall: effectiveOverall,
            ...(Object.keys(fieldOverrides).length ? { humanOverrides: fieldOverrides } : {}),
            ...(Object.keys(fieldNotes).length ? { humanNotes: fieldNotes } : {}),
          }
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
        overall: effectiveOverall ?? undefined,
      },
    ]));
  }

  const missingLabels = missingKeys.map((k) => KEY_LABEL[k]);
  const announce = !extracted
    ? ""
    : combined?.verify
      ? `Verdict: ${VERDICT_LABEL[effectiveOverall ?? "review"]}.`
      : `Label read. Complete the required application fields to verify: ${missingLabels.join(", ")}.`;

  const firstImage = orderedImages[0];
  const viewFirstImage = firstImage
    ? () => setZoom({ src: firstImage.preview, alt: `Label: ${firstImage.file.name}` })
    : undefined;

  const pipelineStage: "reading" | "awaiting" | "done" | null =
    state === "loading" ? "reading" : readable ? (combined?.verify ? "done" : "awaiting") : null;

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
        Upload the product&apos;s front label (and the back, if you have it). The AI reads it, then you
        confirm what the application claims. The screen checks the label against the application
        field-by-field and the statutory government warning, and flags every mismatch as Approve / Needs
        review / Reject.
      </p>

      {mockMode && (
        <p className="mt-3 rounded-field border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
          <strong className="font-semibold text-ink">Demo mode.</strong> This preview recognizes the
          built-in sample labels only. To read your own photos, a vision provider must be configured.
          See the README.
        </p>
      )}

      {/* Step 1 — upload into explicit Front / Back slots */}
      <div className="mt-6">
        <h3 className="mb-1.5 block font-medium text-ink">Step 1 · Label images</h3>
        <p id={ids.imageHelp} className="sr-only">
          Upload the front label (required) and optionally the back label. Click an image to enlarge it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["front", "back"] as const).map((key) => {
            const img = slots[key];
            const label = key === "front" ? "Front / full label" : "Back label";
            return (
              <div key={key}>
                <span className="mb-1.5 block text-sm font-medium text-ink">
                  {label}{" "}
                  <span className="font-normal text-ink-muted">{key === "front" ? "(required)" : "(optional)"}</span>
                </span>
                {img ? (
                  <figure className="overflow-hidden rounded-card border border-border bg-surface-muted shadow-card">
                    <button
                      type="button"
                      onClick={() => setZoom({ src: img.preview, alt: `${label}: ${img.file.name}` })}
                      aria-label={`Enlarge ${img.file.name}`}
                      className="group relative block w-full cursor-zoom-in bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                      <img src={img.preview} alt="" className="h-52 w-full object-contain" />
                      <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-pill bg-black/65 px-2.5 py-1 text-xs font-semibold text-white opacity-90 transition group-hover:opacity-100">
                        <IconZoom /> Enlarge
                      </span>
                    </button>
                    <figcaption className="flex items-center gap-3 border-t border-border bg-surface px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-ink" title={img.file.name}>
                        {img.file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => clearSlot(key)}
                        className="min-h-[40px] shrink-0 rounded-field border-2 border-border-strong px-3 text-sm font-semibold text-ink transition hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                      >
                        Remove
                      </button>
                    </figcaption>
                  </figure>
                ) : (
                  <DropZone
                    id={`${ids.image}-${key}`}
                    multiple={false}
                    required={key === "front"}
                    ariaLabel={key === "front" ? "Upload front or full label (required)" : "Upload back label (optional)"}
                    onFiles={(files) => files[0] && setSlot(key, files[0])}
                    describedById={ids.imageHelp}
                  />
                )}
              </div>
            );
          })}
        </div>
        {/* Self-sufficient demo: a cold visitor has no label image on hand. The three bundled sample
            labels are served from /public/samples with their filenames intact, so the offline mock
            recognizes them AND a live provider reads their real pixels. Plain download links keep the
            upload flow honest (no special in-app path). */}
        {!slots.front && (
          <p className="mt-3 text-sm text-ink-muted">
            No label handy? Download a sample to upload:{" "}
            <a href="/samples/demo-old-tom-clean.png" download className={linkClass}>
              clean bourbon
            </a>
            {", "}
            <a href="/samples/demo-warning-title-case.png" download className={linkClass}>
              title-case warning
            </a>
            {", or "}
            <a href="/samples/demo-brand-typo.png" download className={linkClass}>
              brand typo
            </a>
            .
          </p>
        )}
      </div>

      {/* Step 2 — the application: the reference the label is verified against. The AI's reading is
          SUGGESTED in grey; the agent accepts (Tab / "Accept all") or types the application's value.
          Every field TTB requires for the beverage type (marked *) must be filled before a verdict. */}
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-medium text-ink">Step 2 · The application</h3>
          {extracted && hasUnacceptedSuggestions && (
            <button
              type="button"
              onClick={acceptAllSuggestions}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-field bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              <IconPass className="h-4 w-4" /> Accept all AI suggestions
            </button>
          )}
        </div>
        <p className="mb-3 mt-1 text-sm text-ink-muted">
          {extracted ? (
            <>
              The AI&apos;s reading is suggested in grey. Press <kbd className="rounded border border-border bg-surface-muted px-1 font-sans text-xs">Tab</kbd> to accept a field, or use{" "}
              <strong className="text-ink">Accept all</strong>. Fields TTB requires for this type are
              marked <span className="font-bold text-fail-700">*</span> and must be filled to verify.
            </>
          ) : (
            <>Upload a label first. The AI&apos;s reading will pre-fill these as suggestions you can accept or correct.</>
          )}
        </p>

        {/* Beverage type — AI-prefilled, agent-overridable; drives the required-field set + ABV tolerance. */}
        {extracted && (
          <div className="mb-4 max-w-sm">
            <label htmlFor={ids.appType} className="mb-1.5 block text-sm font-medium text-ink">
              Beverage type
            </label>
            <select
              id={ids.appType}
              value={selectorChoice}
              onChange={(e) => setClassChoice(e.target.value as ClassChoice)}
              className={inputClass}
            >
              {CLASS_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-muted">
              {classChoice
                ? "Changed by you. Required fields updated."
                : aiClassText?.trim()
                  ? "The AI read this. Change it if it's wrong."
                  : "No type was read from the label. Pick one to set the required fields."}
            </span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {appInputs.map((f) => {
            const required = requiredKeys.includes(f.key as RequirementKey);
            const hasSuggestion = Boolean(f.suggestion && f.suggestion.trim());
            const lowConf = hasSuggestion && typeof f.confidence === "number" && f.confidence < FIELD_REVIEW_CONFIDENCE;
            const accepted = hasSuggestion && f.value.trim() !== "" && norm(f.value) === norm(f.suggestion ?? "");
            // The Tab-to-accept hint is wired to the input via aria-describedby so a screen-reader
            // user hears that Tab has a side effect here, not just sighted users.
            const showHint = f.value.trim() === "" && hasSuggestion && !editedInputs.has(f.id);
            const hintId = `${f.id}-hint`;
            return (
              <div key={f.id} className="relative">
                {/* The "?" toggletip sits BESIDE the label, not inside it: inside, a click would
                    focus the input and the help text would join the input's accessible name. The
                    `relative` makes this field the open bubble's positioning context (full width). */}
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                  <label htmlFor={f.id}>
                    {f.label}
                    {required && <span className="text-fail-700" aria-hidden="true"> *</span>}
                    {f.hint && <span className="font-normal text-ink-muted"> ({f.hint})</span>}
                  </label>
                  <FieldHelp label={f.label} text={APP_FIELD_HELP[f.key]} />
                  {lowConf && (
                    <span className="rounded-pill border border-review-500 bg-review-50 px-1.5 py-0.5 text-xs font-semibold text-review-900">
                      Low confidence ({Math.round((f.confidence ?? 0) * 100)}%)
                    </span>
                  )}
                  {accepted && (
                    <span className="rounded-pill border border-border bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                      from label
                    </span>
                  )}
                </div>
                <input
                  id={f.id}
                  type="text"
                  value={f.value}
                  onChange={(e) => {
                    f.set(e.target.value);
                    markEdited(f.id);
                  }}
                  onKeyDown={(e) => acceptOnTab(e, f.id, f.value, f.suggestion, f.set)}
                  placeholder={hasSuggestion && !editedInputs.has(f.id) ? f.suggestion : undefined}
                  required={required}
                  aria-required={required}
                  aria-describedby={showHint ? hintId : undefined}
                  className={lowConf ? LOW_CONF_INPUT : inputClass}
                />
                {showHint && (
                  <span id={hintId} className="mt-1 block text-xs text-ink-muted">
                    Suggested from the label. Press Tab to accept.
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* The order-of-operations spine: read the label → AI confidence → compare → verdict. */}
      {pipelineStage && (
        <div className="mt-8 border-t border-border pt-6">
          <PipelineSteps stage={pipelineStage} verdict={effectiveOverall ?? undefined} />
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {formError && (
        <div className="mt-5">
          <ErrorAlert id={ids.err}>{formError}</ErrorAlert>
          {/* Recovery in place: re-run the read on the SAME images. Without this, the only way out of
              a transient provider error was Remove + re-upload, which resets the typed application. */}
          {state === "error" && orderedImages.length > 0 && (
            <button
              type="button"
              onClick={() => void read(orderedImages)}
              aria-describedby={ids.err}
              className={`mt-3 ${secondaryButtonClass}`}
            >
              Try again
            </button>
          )}
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

      {/* Results — the headline IS the label-vs-application comparison, shown once every required field
          for the beverage type is supplied. Until then, the screen lists exactly what's still needed
          (it never presents the completeness check as the answer). */}
      {readable && response && combined && (
        <>
          {combined.verify ? (
            <>
              <ResultView
                step="Step 3"
                result={combined.verify}
                overall={effectiveOverall ?? undefined}
                gatedByCompleteness={effectiveGatedByCompleteness}
                headingRef={headlineRef}
                onViewImage={viewFirstImage}
                overrides={fieldOverrides}
                onOverride={setOverride}
                concerns={completenessConcerns}
                notes={fieldNotes}
                onNote={setNote}
              />
              <details className="mt-6 rounded-card border border-border bg-surface-muted p-4">
                <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
                  Supporting check: TTB completeness
                </summary>
                <CompletenessView completeness={combined.completeness} overrides={completenessOverrides} />
              </details>
              <DecisionPanel
                step="Step 4"
                verdict={effectiveOverall ?? "review"}
                brand={claimBrand}
                approveNotes={approveNotes}
                rejectNotes={rejectNotes}
              />
            </>
          ) : (
            <section aria-label="Complete the application" className="mt-6 flex flex-col gap-4">
              <div className="flex items-start gap-4 rounded-card border-l-8 border-brand-600 bg-brand-50 p-6 shadow-card">
                <IconReview className="h-9 w-9 shrink-0 text-brand-700" />
                <div className="min-w-0">
                  <h2
                    ref={headlineRef}
                    tabIndex={-1}
                    className="text-lg font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                  >
                    Complete the application to verify
                  </h2>
                  <p className="mt-1.5 text-sm text-ink">
                    The label was read. TTB requires {missingKeys.length === 1 ? "this field" : "these fields"} for a{" "}
                    <strong>{CLASS_DISPLAY_LABEL[beverageClass]}</strong> before a verdict:
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {missingKeys.map((k) => (
                      <li
                        key={k}
                        className="rounded-pill border border-brand-600 bg-surface px-2.5 py-0.5 text-sm font-semibold text-brand-700"
                      >
                        {KEY_LABEL[k]}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 text-sm text-ink-muted">
                    Accept the grey suggestions above (Tab or <strong className="text-ink">Accept all</strong>), or
                    type the application&apos;s values.
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
