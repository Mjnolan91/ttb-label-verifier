"use client";

/**
 * VerifyForm — the single "verify a label" screen (the spec's core loop).
 *
 * Drop a product's label image(s) — front, back, and the neck/strip if there is one — and the AI
 * reads them TOGETHER into one structured
 * record. The screen ALWAYS runs the deterministic TTB completeness check; the agent then confirms the
 * application's values (the AI's reading is SUGGESTED in grey — Tab or "Accept all" to accept), and the
 * screen LEADS with the label-vs-application comparison once every field TTB REQUIRES for the beverage
 * type is supplied. The required set is DYNAMIC per type (requiredInputKeysFor, from the CFR matrix):
 * spirits/wine>14%/unknown require alcohol; wine≤14%/malt/cider don't. Accessibility (WCAG 2.1 AA):
 * labelled controls, >=44px targets, visible focus, aria-live result regions, focus moved to the result.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { VerifyApiResponse, VerifyApiError } from "./api/verify/contract";
import type { ImageReadFailure } from "@/pipeline";
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
import { deriveLabelReview, toggleOverride, setFieldNote, capVerdictForPartialRead, type FieldNotes } from "./ui/labelReview";
import { DecisionPanel } from "./ui/DecisionPanel";
import { PipelineSteps } from "./ui/PipelineSteps";
import { CLASS_DISPLAY_LABEL } from "./ui/beverageClass";
import { AppValueField } from "./ui/AppValueField";
import { downscaleForUpload } from "./imageDownscale";
import { DropZone } from "./ui/DropZone";
import { FieldHelp } from "./ui/FieldHelp";
import { APP_FIELD_HELP, type AppInputKey } from "./ui/fieldHelpCopy";
import { APP_INPUT_SPECS, appInputConfidence, appInputSuggestion, countryOfOriginImportNote } from "./ui/appInputs";
import { ErrorAlert } from "./ui/ErrorAlert";
import { ResultSkeleton } from "./ui/ResultSkeleton";
import { inputClass, linkClass, secondaryButtonClass } from "./ui/fieldStyles";
import { downloadJson, downloadCsv } from "./ui/download";
import { analysisToCsv } from "@/batch/csv";
import { parsePositionToken } from "@/batch/pairing";
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
type SlotKey = "front" | "back" | "neck";
type Slots = Partial<Record<SlotKey, LabelImage>>;

/** The ordered, present-only image list to read/export: front, then back, then neck — the merge
 *  fills gaps left-to-right, so the front (the product anchor) wins any conflict. */
const orderedImagesOf = (s: Slots): LabelImage[] =>
  [s.front, s.back, s.neck].filter(Boolean) as LabelImage[];

/** The explicit slots: position is fixed by the slot (no order-guessing, no dropdown). Front anchors
 *  the product; back and neck are optional. The NECK slot is progressively disclosed — most products
 *  have no neck/strip label, so the default screen stays two slots (see "Add a neck or strip label"). */
const SLOT_DEFS: Record<SlotKey, { label: string; required: boolean; ariaLabel: string }> = {
  front: { label: "Front / full label", required: true, ariaLabel: "Upload front or full label (required)" },
  back: { label: "Back label", required: false, ariaLabel: "Upload back label (optional)" },
  neck: { label: "Neck / strip label", required: false, ariaLabel: "Upload neck or strip label (optional)" },
};

/** The slot's human label for a failed image, falling back to its filename ("other" has no slot). */
function failedImageName(f: ImageReadFailure): string {
  return f.position && f.position !== "other" ? SLOT_DEFS[f.position].label : f.filename;
}

/** Human description of a partial read: which image(s) dropped out and why. Shown as a warning so a
 *  dropped back label can never masquerade as "the label is missing its mandatory fields". */
function describeImageFailures(failures: ImageReadFailure[]): string {
  const what = failures.map(failedImageName).join(" and ");
  const timedOut = failures.every((f) => f.reason === "timeout");
  const plural = failures.length > 1 ? "images" : "image";
  return `The ${what} ${plural} couldn't be read${timedOut ? " (the read timed out)" : ""}. The results below reflect only the images that were read.`;
}

/** Human label for each application input / requirement key (used by the "still needed" checklist). */
const KEY_LABEL: Record<RequirementKey, string> = {
  brand: "Brand name",
  classType: "Class / type designation",
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
  // The label is uploaded into explicit slots (SLOT_DEFS) — Front (required), Back (optional), and a
  // progressively-disclosed Neck/strip — so the agent says what each image is.
  const [slots, setSlots] = useState<Slots>({});
  // The neck/strip slot is hidden until asked for (most products have none). It stays open while a
  // neck image is loaded and collapses back to the disclosure button when that image is removed.
  const [neckRevealed, setNeckRevealed] = useState(false);
  // A multi-select placed more files than the three slots hold: say so, never lose files silently.
  const [placementNotice, setPlacementNotice] = useState<string | null>(null);
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
  const neckInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state !== "done") return;
    headlineRef.current?.focus();
  }, [state]);

  // Revealing the neck slot unmounts the disclosure button the keyboard user just pressed; move
  // focus into the new slot's file input so they aren't dropped back to the top of the page.
  useEffect(() => {
    if (neckRevealed && !slots.neck) neckInputRef.current?.focus();
  }, [neckRevealed, slots.neck]);

  const readable = state === "done" && Boolean(response?.readable);
  const extracted = readable && response ? response.extracted : undefined;

  // This screen's per-input state, keyed so a new AppInputKey without wiring is a compile error.
  const fieldState: Record<AppInputKey, { id: string; value: string; set: (v: string) => void }> = {
    brand: { id: ids.appBrand, value: claimBrand, set: setClaimBrand },
    classType: { id: ids.appClass, value: claimClass, set: setClaimClass },
    alcoholContent: { id: ids.appAlcohol, value: claimAlcohol, set: setClaimAlcohol },
    netContents: { id: ids.appNet, value: claimNet, set: setClaimNet },
    name: { id: ids.appName, value: claimName, set: setClaimName },
    address: { id: ids.appAddress, value: claimAddress, set: setClaimAddress },
    countryOfOrigin: { id: ids.appCountry, value: claimCountry, set: setClaimCountry },
    fancifulName: { id: ids.appFanciful, value: claimFanciful, set: setClaimFanciful },
    statementOfComposition: { id: ids.appSoc, value: claimSoc, set: setClaimSoc },
  };

  // The inputs themselves derive from the SHARED descriptor (labels, hints, suggestion + confidence
  // mapping — src/app/ui/appInputs.ts, also consumed by the batch drawer's editor), plus this
  // screen's state wiring. The required set is dynamic (below), so each input renders uniformly and
  // is marked required per the resolved type. Country of origin is suggested only for an IMPORT: a
  // vision model sometimes infers "USA" from the producer address, and the input is imports-only.
  const appInputs = APP_INPUT_SPECS.map((spec) => ({
    ...spec,
    ...fieldState[spec.key],
    suggestion: extracted ? appInputSuggestion(extracted, spec.key) : undefined,
    confidence: extracted ? appInputConfidence(extracted, spec.key) : undefined,
  }));

  // Resolve the beverage class that DRIVES the required set: the agent's override wins, else the AI's
  // reading; the wine ≤14/>14 split uses the ABV (typed value preferred, else the label's).
  const aiClassText = extracted ? appInputSuggestion(extracted, "classType") : undefined;
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

  // A PARTIAL read (one image dropped out) caps the displayed/exported verdict at review: the unread
  // image could contradict anything, so matching on partial evidence must never headline Approve.
  // The reviewer's explicitly recorded decision (DecisionPanel) remains their own call.
  const partialRead = readable && (response?.imageFailures?.length ?? 0) > 0;
  const shownOverall = capVerdictForPartialRead(effectiveOverall, partialRead);

  // Accept the AI's grey suggestion for one field by pressing Tab while it's empty (the agent confirms
  // the read as the application value) — fast, but deliberate, so an unaccepted required field still blocks.
  function acceptOnTab(e: KeyboardEvent<HTMLTextAreaElement>, id: string, value: string, suggestion: string | undefined, set: (v: string) => void) {
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
  const hasAnySuggestion = appInputs.some((f) => f.suggestion?.trim());

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
  /**
   * Place a multi-file selection in ONE state update + ONE read. Files with an explicit filename
   * position token (-front/-back/-neck, see parsePositionToken) claim their slot — replacing what
   * is there, since the user just said which label this is; the first claimant wins a token
   * collision and later claimants join the tokenless pool. Tokenless files fill EMPTY slots only:
   * the zone they were dropped on first, then front, back, neck. Anything beyond three images
   * surfaces an honest notice (this screen verifies ONE product) — never silent loss. Replacing
   * the FRONT is a product change, so the typed application resets (clearSlot's rule).
   */
  function placeFiles(slotHint: SlotKey, files: File[]) {
    if (files.length === 0) return;
    const next: Slots = { ...slots };
    const replaced: LabelImage[] = [];
    let frontReplaced = false;
    const put = (key: SlotKey, file: File) => {
      const old = next[key];
      if (old) replaced.push(old);
      if (key === "front" && slots.front) frontReplaced = true;
      next[key] = { file, preview: URL.createObjectURL(file), position: key as LabelPosition };
    };
    const tokenless: File[] = [];
    const claimed = new Set<SlotKey>();
    for (const file of files) {
      const { position } = parsePositionToken(file.name);
      if (position && position !== "other" && !claimed.has(position)) {
        claimed.add(position);
        put(position, file);
      } else {
        tokenless.push(file);
      }
    }
    const fillOrder: SlotKey[] = [slotHint, "front", "back", "neck"];
    const leftovers: File[] = [];
    for (const file of tokenless) {
      const empty = fillOrder.find((k) => !next[k]);
      if (empty) put(empty, file);
      else leftovers.push(file);
    }
    for (const old of replaced) {
      if (zoom?.src === old.preview) setZoom(null);
      URL.revokeObjectURL(old.preview);
    }
    if (next.neck) setNeckRevealed(true);
    if (frontReplaced) resetApplication();
    setPlacementNotice(
      leftovers.length > 0
        ? `${leftovers.length} ${leftovers.length === 1 ? "file was" : "files were"} not used. This screen verifies one product (front, back, and neck labels); Batch mode reads many products at once.`
        : null,
    );
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
    if (key === "neck") setNeckRevealed(false); // collapse the slot back to its disclosure button
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
      // The audit record must carry the partial-read fact: without it a saved approval over a
      // dropped image reads as a clean two-image verification.
      ...(response.imageFailures?.length ? { imageFailures: response.imageFailures } : {}),
      ...(claimed ? { claimed } : {}),
      ...(combined.verify
        ? {
            result: combined.verify,
            overall: shownOverall,
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
        overall: shownOverall ?? undefined,
        readFailures: response.imageFailures?.length ? describeImageFailures(response.imageFailures) : undefined,
      },
    ]));
  }

  const missingLabels = missingKeys.map((k) => KEY_LABEL[k]);
  const announce = !extracted
    ? ""
    : combined?.verify
      ? `Verdict: ${VERDICT_LABEL[shownOverall ?? "review"]}.`
      : `Label read. Complete the required application fields to verify: ${missingLabels.join(", ")}.`;

  // The lightbox carries EVERY uploaded image (front first) so "confirm it on the label" never
  // means the front only — the government warning usually lives on the back. Slot labels name
  // each image as the reviewer steps through.
  const lightboxImages = orderedImages.map((i) => ({
    src: i.preview,
    alt: `${i.position !== "other" ? SLOT_DEFS[i.position as SlotKey].label : "Label"}: ${i.file.name}`,
  }));
  const viewLabelImages = lightboxImages.length > 0 ? () => setZoom(lightboxImages[0]) : undefined;

  const pipelineStage: "reading" | "awaiting" | "done" | null =
    state === "loading" ? "reading" : readable ? (combined?.verify ? "done" : "awaiting") : null;

  const neckVisible = neckRevealed || Boolean(slots.neck);
  const slotKeys: readonly SlotKey[] = neckVisible ? ["front", "back", "neck"] : ["front", "back"];

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
        Upload the product&apos;s front label (plus the back or neck, if you have them). The AI reads it, then you
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
          Upload the front label (required) and optionally the back and neck or strip labels. You can
          select several photos at once: filenames like name-front and name-back place themselves, and
          the rest fill the open slots in order. Click an image to enlarge it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {slotKeys.map((key) => {
            const img = slots[key];
            const { label, required, ariaLabel } = SLOT_DEFS[key];
            return (
              <div key={key}>
                <span className="mb-1.5 block text-sm font-medium text-ink">
                  {label}{" "}
                  <span className="font-normal text-ink-muted">{required ? "(required)" : "(optional)"}</span>
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
                        aria-label={`Remove ${label}`}
                        className="min-h-[40px] shrink-0 rounded-field border-2 border-border-strong px-3 text-sm font-semibold text-ink transition hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                      >
                        Remove
                      </button>
                    </figcaption>
                  </figure>
                ) : (
                  <DropZone
                    id={`${ids.image}-${key}`}
                    required={required}
                    ariaLabel={ariaLabel}
                    inputRef={key === "neck" ? neckInputRef : undefined}
                    onFiles={(files) => placeFiles(key, files)}
                    describedById={ids.imageHelp}
                  />
                )}
              </div>
            );
          })}
        </div>
        {/* A multi-select bigger than the three slots: say what was left out, offer no silent loss. */}
        {placementNotice && (
          <p
            role="status"
            className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-field border border-border bg-surface-muted px-3 py-2 text-sm text-ink"
          >
            <span className="min-w-[14rem] flex-1">{placementNotice}</span>
            <button
              type="button"
              onClick={() => setPlacementNotice(null)}
              className="min-h-[36px] shrink-0 rounded-field border border-border-strong px-2.5 text-xs font-semibold text-ink transition hover:border-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            >
              Dismiss
            </button>
          </p>
        )}
        {/* A PARTIAL read warns loudly: the merge proceeded from the surviving images, so the
            extracted fields below are honest but incomplete — never let that look like a clean read. */}
        {readable && response?.imageFailures && response.imageFailures.length > 0 && (
          <div
            role="alert"
            className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-field border-2 border-review-500 bg-review-50 px-3 py-2.5 text-sm font-medium text-review-900"
          >
            <span className="min-w-[14rem] flex-1">{describeImageFailures(response.imageFailures)}</span>
            <button
              type="button"
              onClick={() => void read(orderedImages)}
              className="min-h-[40px] shrink-0 rounded-field border-2 border-border-strong bg-surface px-3 text-sm font-semibold text-ink transition hover:border-brand-600 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              Try reading again
            </button>
          </div>
        )}
        {/* Most products have no neck/strip label, so the third slot is disclosed on demand: the
            default screen stays two slots and the button still advertises the capability. */}
        {!neckVisible && (
          <p className="mt-2">
            <button
              type="button"
              onClick={() => setNeckRevealed(true)}
              className={"inline-flex min-h-[44px] items-center gap-1.5 text-sm " + linkClass}
            >
              <span aria-hidden="true">+</span> Add a neck or strip label
            </button>
          </p>
        )}
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
          {/* Stays MOUNTED (disabled) once all suggestions are accepted: unmounting the focused
              button on click strands keyboard focus on <body>. */}
          {extracted && hasAnySuggestion && (
            <button
              type="button"
              onClick={acceptAllSuggestions}
              disabled={!hasUnacceptedSuggestions}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-field bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconPass className="h-4 w-4" />
              {hasUnacceptedSuggestions ? "Accept all AI suggestions" : "All suggestions accepted"}
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
            // The imports-only country input must SAY when an import was inferred but nothing is
            // printed to transcribe: a silently blank field reads as "the AI missed it".
            const importNote =
              f.key === "countryOfOrigin" && extracted ? countryOfOriginImportNote(extracted) : undefined;
            const hintId = `${f.id}-hint`;
            const metaId = `${f.id}-meta`;
            const noteId = `${f.id}-import-note`;
            const describedBy = [
              showHint ? hintId : null,
              lowConf || accepted ? metaId : null,
              importNote ? noteId : null,
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div key={f.id} className="relative">
                {/* The "?" toggletip sits BESIDE the label, not inside it: inside, a click would
                    focus the input and the help text would join the input's accessible name. The
                    `relative` makes this field the open bubble's positioning context (full width).
                    The label row holds ONLY constant-height content (label + "?"): the chips live
                    BELOW the input, because anything variable ABOVE it wraps to a second line and
                    shifts this cell's input out of alignment with its grid-row neighbor. */}
                <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink">
                  <label htmlFor={f.id}>
                    {f.label}
                    {required && <span className="text-fail-700" aria-hidden="true"> *</span>}
                    {f.hint && <span className="font-normal text-ink-muted"> ({f.hint})</span>}
                  </label>
                  <FieldHelp label={f.label} text={APP_FIELD_HELP[f.key]} />
                </div>
                <AppValueField
                  id={f.id}
                  value={f.value}
                  onValueChange={(v) => {
                    f.set(v);
                    markEdited(f.id);
                  }}
                  onKeyDown={(e) => acceptOnTab(e, f.id, f.value, f.suggestion, f.set)}
                  placeholder={hasSuggestion && !editedInputs.has(f.id) ? f.suggestion : undefined}
                  required={required}
                  aria-describedby={describedBy || undefined}
                  className={lowConf ? LOW_CONF_INPUT : inputClass}
                />
                {(lowConf || accepted) && (
                  <span id={metaId} className="mt-1 flex flex-wrap items-center gap-1.5">
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
                  </span>
                )}
                {importNote && (
                  <span id={noteId} className="mt-1 block break-words text-xs font-medium text-review-700">
                    {importNote}
                  </span>
                )}
                {showHint && (
                  /* The FULL suggestion is repeated here (wrapping): a long value truncates inside
                     the single-line input's placeholder, and the agent must be able to read what
                     they are about to accept. */
                  <span id={hintId} className="mt-1 block break-words text-xs text-ink-muted">
                    Suggested: <span className="font-medium text-ink">{f.suggestion}</span>. Press Tab
                    to accept.
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
          <PipelineSteps stage={pipelineStage} verdict={shownOverall ?? undefined} />
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
                overall={shownOverall ?? undefined}
                gatedByCompleteness={effectiveGatedByCompleteness}
                headingRef={headlineRef}
                onViewImage={viewLabelImages}
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
                verdict={shownOverall ?? "review"}
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
        images={lightboxImages}
        initialIndex={Math.max(0, lightboxImages.findIndex((im) => im.src === zoom?.src))}
        onClose={() => setZoom(null)}
      />
    </section>
  );
}
