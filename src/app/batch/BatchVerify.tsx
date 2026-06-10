"use client";

/**
 * BatchVerify — the batch worklist (the 200-300-labels-at-once story).
 *
 * Upload many label images; they're grouped into PRODUCTS by filename convention (acme-front.jpg +
 * acme-back.jpg -> one product, read together) and read by the AI through a small worker pool. An
 * optional application-values CSV supplies each product's claimed values: matched rows get the same
 * combinedVerdict the single screen computes (gated per beverage type — see toClaimedFields). Every
 * row lands in a reviewable worklist (localStorage decisions, per-row Review drawer built from the
 * single screen's components) and exports as JSON or CSV, decisions included.
 */
import { useId, useMemo, useState } from "react";
import type { ExtractedFields } from "@/domain";
import type { CompletenessResult, CombinedVerdict } from "@/compare";
import type { LabelPosition } from "@/extraction";
import { groupImagesByProduct } from "@/batch/pairing";
import { analysisToCsv, parseClaimedCsv, type ClaimedRow } from "@/batch/csv";
import { resolveClaimedFor } from "@/batch/claimedMatch";
import { combinedVerdict, toClaimedFields, type VerifyResult } from "@/compare";
import type { VerifyApiResponse, VerifyApiError } from "../api/verify/contract";
import { downscaleForUpload } from "../imageDownscale";
import { ErrorAlert } from "../ui/ErrorAlert";
import { StatusBadge } from "../ui/StatusBadge";
import { toneForStatus, VERDICT_LABEL, COMPLETENESS_LABEL, type Tone } from "../ui/status";
import { CLASS_DISPLAY_LABEL } from "../ui/beverageClass";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "../ui/fieldStyles";
import { downloadJson, downloadCsv } from "../ui/download";
import { DropZone } from "../ui/DropZone";
import { ImageLightbox } from "../ui/ImageLightbox";
import { Drawer } from "../ui/Drawer";
import { ProductReview } from "../ui/ProductReview";
import { deriveLabelReview, toggleOverride, setFieldNote } from "../ui/labelReview";
import { useWorklist } from "./useWorklist";
import { IconZoom, IconPass, IconFail } from "../ui/icons";

const CONCURRENCY = 4;

interface ProductImages {
  product: string;
  images: { file: File; position: LabelPosition }[];
}
interface BatchRow {
  product: string;
  imageCount: number;
  status: "pending" | "done" | "error";
  extracted?: ExtractedFields;
  completeness?: CompletenessResult;
  /** The full combined verdict (verify + completeness), the source the worklist review re-derives from. */
  combined?: CombinedVerdict | null;
  /** The product's label image previews, for the review drawer. */
  images?: { src: string; alt: string }[];
  /** Application-match verdict, when an application-values CSV row matched this product. */
  result?: VerifyResult | null;
  /** Headline verdict after gating on completeness. */
  overall?: VerifyResult["overall"] | null;
  /** True when an application-values CSV row matched this product — even if the label was unreadable
   *  (so a matched-but-unreadable scan isn't mislabeled "no application row"). */
  matchedClaim?: boolean;
  /** Whether the label itself was readable (drives the re-scan vs. add-claim-value prompts). */
  readable?: boolean;
  /** When a row matched but its claim lacks a value the verdict needs (brand AND alcohol), the
   *  human-readable list of what to add — so a brand-only row prompts instead of rendering blank. */
  claimedNeeds?: string;
  note?: string;
}

const COMPLETENESS_TONE: Record<CompletenessResult["overall"], Tone> = {
  complete: "pass",
  incomplete: "fail",
  review: "review",
};

function groupFiles(files: File[]): ProductImages[] {
  const byName = new Map(files.map((f) => [f.name, f]));
  return groupImagesByProduct(files.map((f) => f.name)).map((g) => ({
    product: g.product,
    images: g.images.map((im) => ({ file: byName.get(im.filename) as File, position: im.position })),
  }));
}

async function analyzeProduct(
  group: ProductImages,
  claimedMap: Map<string, ClaimedRow>,
  previewByName: Map<string, string>,
): Promise<BatchRow> {
  const images = group.images.map((im) => ({ src: previewByName.get(im.file.name) ?? "", alt: im.file.name }));
  const base: BatchRow = { product: group.product, imageCount: group.images.length, status: "error", images };
  try {
    const form = new FormData();
    for (const img of group.images) {
      form.append("image", await downscaleForUpload(img.file));
      form.append("position", img.position);
    }
    const res = await fetch("/api/verify", { method: "POST", body: form });
    const json: VerifyApiResponse | VerifyApiError = await res.json();
    if (!res.ok) return { ...base, note: (json as VerifyApiError).error };
    const r = json as VerifyApiResponse;
    // If the application-values CSV has a row for this product (by image filename or product stem),
    // run the same deterministic verifyLabel comparison used on the single screen.
    const claimedRow = resolveClaimedFor(
      { product: group.product, images: group.images.map((im) => ({ filename: im.file.name, position: im.position })) },
      claimedMap,
    );
    // The batch "enough to compare?" gate (toClaimedFields): brand always, alcohol only where the
    // law requires it for the resolved beverage class — so a legal malt/table-wine row without an
    // ABV still gets a verdict. (The single screen gates interactively on its full per-type input
    // set instead; same requiredInputKeysFor matrix, different gate.) `missing` drives the prompt.
    const gate = claimedRow
      ? toClaimedFields(
          {
            brand: claimedRow.brand,
            alcoholContentText: claimedRow.alcoholContent,
            classType: claimedRow.classType,
            netContents: claimedRow.netContents,
            name: claimedRow.name,
            address: claimedRow.address,
            countryOfOrigin: claimedRow.countryOfOrigin,
            fancifulName: claimedRow.fancifulName,
            statementOfComposition: claimedRow.statementOfComposition,
          },
          r.extracted,
        )
      : null;
    const claimedFields = gate?.claimed ?? null;
    const NEED_PHRASE: Partial<Record<string, string>> = { brand: "a brand", alcoholContent: "alcohol content" };
    const needs = (gate?.missing ?? []).map((k) => NEED_PHRASE[k] ?? k).join(" + ");
    // Every readable product gets a combined verdict (completeness-only when no application row matched),
    // so it can be reviewed in the worklist — not just the ones with a matched claim.
    const combined = r.readable ? combinedVerdict(claimedFields, r.extracted) : null;
    return {
      ...base,
      status: "done",
      extracted: r.extracted,
      completeness: r.completeness,
      combined,
      result: combined?.verify ?? null,
      overall: combined?.overall ?? null,
      matchedClaim: Boolean(claimedRow),
      readable: r.readable,
      claimedNeeds: claimedRow && !claimedFields ? needs : undefined,
      note: r.readable ? undefined : r.message,
    };
  } catch {
    return { ...base, note: "Request failed." };
  }
}

const ADD_IMAGES_ERROR = "Add one or more label images.";

function cell(row: BatchRow, pick: (e: ExtractedFields) => string | undefined): string {
  if (row.status === "pending") return "…";
  if (!row.extracted) return "—";
  const v = pick(row.extracted);
  return v && v.trim() !== "" ? v : "—";
}

export function BatchVerify({ mockMode = false }: { mockMode?: boolean }) {
  const ids = { images: useId(), help: useId() };
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const [claimed, setClaimed] = useState<Map<string, ClaimedRow>>(new Map());
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The review worklist (localStorage-backed) + which row's review drawer is open.
  const worklist = useWorklist();
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);

  const groups = useMemo(() => groupFiles(images.map((im) => im.file)), [images]);
  const previewByName = useMemo(() => new Map(images.map((im) => [im.file.name, im.preview])), [images]);

  /** The headline verdict for a row AFTER the reviewer's resolved flags (parity with the single screen). */
  const effectiveVerdictOf = (r: BatchRow) =>
    r.combined ? deriveLabelReview(r.combined, worklist.worklist[r.product]?.overrides ?? {}).effectiveOverall : null;

  function addFiles(newFiles: File[]) {
    setImages((prev) => [...prev, ...newFiles.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
    // Adding images satisfies the "add images" validation; a stale error banner over a now-valid
    // form reads as broken. (Other errors, e.g. a rejected CSV, are unrelated to this action.)
    setError((prev) => (prev === ADD_IMAGES_ERROR ? null : prev));
  }
  function removeImage(index: number) {
    setImages((prev) => {
      const target = prev[index];
      if (target) {
        if (zoom?.src === target.preview) setZoom(null);
        URL.revokeObjectURL(target.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  async function process() {
    setError(null);
    if (images.length === 0) {
      setError(ADD_IMAGES_ERROR);
      return;
    }
    setRows(groups.map((g) => ({ product: g.product, imageCount: g.images.length, status: "pending" })));
    setRunning(true);
    setDone(0);

    let next = 0;
    let completed = 0;
    const worker = async () => {
      while (next < groups.length) {
        const idx = next++;
        const row = await analyzeProduct(groups[idx], claimed, previewByName);
        setRows((prev) => {
          const copy = prev.slice();
          copy[idx] = row;
          return copy;
        });
        completed++;
        setDone(completed);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, groups.length) }, worker));
    setRunning(false);
  }

  const completedRows = rows.filter((r) => r.status === "done" && r.extracted);
  // An application CSV was loaded but matched no product — almost always a filename-column mismatch.
  // Surface it instead of silently showing "no application row" on every row.
  const noneMatched =
    !running && rows.length > 0 && claimed.size > 0 && rows.every((r) => !r.result && !r.matchedClaim);
  function exportJson() {
    downloadJson(
      "ttb-extractions.json",
      completedRows.map((r) => {
        const rec = worklist.worklist[r.product];
        const overall = effectiveVerdictOf(r) ?? r.overall ?? null;
        return {
          product: r.product,
          extracted: r.extracted,
          completeness: r.completeness,
          // Mirror the single-screen JSON: carry the (override-aware) verdict so JSON and CSV agree.
          ...(r.result ? { result: r.result } : {}),
          ...(overall ? { overall } : {}),
          // The worklist lifecycle: the reviewer's recorded decision, distinct from the AI verdict.
          ...(rec?.decision ? { decision: rec.decision, note: rec.note ?? "" } : {}),
          ...(rec?.notes && Object.keys(rec.notes).length ? { humanNotes: rec.notes } : {}),
        };
      }),
    );
  }
  function exportCsv() {
    downloadCsv(
      "ttb-extractions.csv",
      analysisToCsv(
        completedRows.map((r) => {
          const rec = worklist.worklist[r.product];
          return {
            filename: r.product,
            extracted: r.extracted as ExtractedFields,
            completeness: r.completeness,
            result: r.result,
            overall: effectiveVerdictOf(r) ?? r.overall,
            decision: rec?.decision,
            note: rec?.note,
          };
        }),
      ),
    );
  }

  const COLS = ["Product", "Type", "Brand", "Alcohol", "Completeness", "Verdict", "Decision", "Review"];

  // Worklist roll-up: how many products the agent has decided, for the summary bar.
  const decisions = completedRows.map((r) => worklist.worklist[r.product]?.decision);
  const approvedCount = decisions.filter((d) => d === "approve").length;
  const returnedCount = decisions.filter((d) => d === "reject").length;
  const decidedCount = approvedCount + returnedCount;

  function clearWorklist() {
    if (typeof window !== "undefined" && !window.confirm("Clear all recorded decisions and resolved flags? This can't be undone.")) {
      return;
    }
    worklist.clearAll();
  }

  const DECISION_CHIP: Record<"approve" | "reject", { label: string; tone: Tone }> = {
    approve: { label: "Approved", tone: "pass" },
    reject: { label: "Returned", tone: "fail" },
  };

  return (
    <section className="rounded-card border border-border border-t-4 border-t-brand-600 bg-surface p-6 shadow-card sm:p-8">
      <h2 className="text-xl font-semibold text-ink">Batch read &amp; review</h2>
      <p className="mt-1 text-ink-muted">
        Upload many label images. They&apos;re grouped into products and read into a table. Open any
        product to <strong className="font-semibold text-ink">Review</strong> it like the single screen:
        resolve flagged fields, record an Approve or send-back, and draft the applicant email. Your
        decisions are saved in this browser and included in the export. Pair a front and back by naming
        them alike with a suffix, e.g. <code>acme-ipa-front.jpg</code> + <code>acme-ipa-back.jpg</code>;
        a file with no suffix is its own single-label product.
      </p>

      {mockMode && (
        <p className="mt-3 rounded-field border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
          <strong className="font-semibold text-ink">Demo mode.</strong> This preview recognizes the
          built-in sample labels only. To read your own photos, a vision provider must be configured.
          See the README.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-5">
        <div>
          <span className="mb-1.5 block font-medium text-ink">
            Label images <span className="font-normal text-ink-muted">(add many)</span>
          </span>
          <DropZone id={ids.images} onFiles={addFiles} describedById={ids.help} />
          <p id={ids.help} className="sr-only">
            Add label images; pair a front and back by naming them alike with a suffix. Click a
            thumbnail to enlarge it.
          </p>
          {images.length > 0 && (
            <>
              <p className="mt-2 text-sm text-ink-muted">
                {images.length} image(s) → <strong className="text-ink">{groups.length} product(s)</strong>{" "}
                {groups.some((g) => g.images.length > 1) ? "(some paired front/back)" : ""}
              </p>
              <ul className="mt-3 flex flex-wrap gap-3">
                {images.map((img, i) => (
                  <li key={`${img.file.name}-${i}`} className="relative">
                    <button
                      type="button"
                      onClick={() => setZoom({ src: img.preview, alt: img.file.name })}
                      aria-label={`Enlarge ${img.file.name}`}
                      title={img.file.name}
                      className="group relative block h-20 w-20 cursor-zoom-in overflow-hidden rounded border border-border bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                      <img src={img.preview} alt="" className="h-full w-full object-contain" />
                      <span className="absolute bottom-0.5 right-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-xs text-white">
                        <IconZoom />
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      aria-label={`Remove ${img.file.name}`}
                      className="absolute -right-2 -top-2 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-surface text-base font-semibold text-ink shadow-card hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <span className="mb-1.5 block font-medium text-ink">
            The application{" "}
            <span className="font-normal text-ink-muted">
              (CSV — one row per product: filename, brand, class, fanciful, composition, alcohol, net,
              name, address, country)
            </span>
          </span>
          <p className="mb-2 text-sm text-ink-muted">
            Each row supplies the application values one product is checked against. <code>filename</code>{" "}
            must match an uploaded image (the front, for a paired product); <code>class</code> is the
            class/type designation only (e.g. <code>Rum</code>, not <code>Superior Caribbean Rum</code>);{" "}
            <code>fanciful</code> + <code>composition</code> apply to specialty products (e.g.{" "}
            <code>Spiced Rum</code> + <code>Rum with natural flavors added</code>). Download the template
            for filled examples.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Application values CSV"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                const map = parseClaimedCsv(await f.text());
                setClaimed(map);
                // A zero-row parse (wrong delimiter, missing/renamed filename column) must not be
                // silent: with no feedback the agent burns a whole batch run before noticing.
                setError(
                  map.size === 0
                    ? "No usable rows found in that CSV. Each row needs a filename column matching an uploaded image; download the template below for the expected format."
                    : null,
                );
              }
              e.target.value = "";
            }}
            className={inputClass}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() =>
                downloadCsv(
                  "application-values-template.csv",
                  // Every field the verifier compares, with realistic rows (a standard imported rum, a malt
                  // beverage, and a SPECIALTY spiced rum showing the fanciful name + statement of composition).
                  // `filename` matches the uploaded image (the FRONT for a paired product); `class` is the
                  // class/type DESIGNATION only (e.g. "Rum", not "Superior Caribbean Rum"); `fanciful` +
                  // `composition` apply to specialties (no standard of identity); leave a cell blank if it
                  // doesn't apply.
                  // The first three rows target the BUNDLED sample labels (downloadable from the
                  // single screen's "No label handy?" links), so template + samples demo the full
                  // verdict spread end to end — offline mock and live provider alike.
                  "filename,brand,class,fanciful,composition,alcohol,net,name,address,country\n" +
                    "demo-old-tom-clean.png,OLD TOM DISTILLERY,Kentucky Straight Bourbon Whiskey,,,45% Alc./Vol. (90 Proof),750 mL,Old Tom Distillery,\"Louisville, KY\",\n" +
                    "demo-warning-title-case.png,OLD TOM DISTILLERY,Kentucky Straight Bourbon Whiskey,,,45% Alc./Vol. (90 Proof),750 mL,Old Tom Distillery,\"Louisville, KY\",\n" +
                    "demo-brand-typo.png,Old Tom Distillery,Kentucky Straight Bourbon Whiskey,,,45% Alc./Vol. (90 Proof),750 mL,Old Tom Distillery,\"Louisville, KY\",\n" +
                    "jolly-jerrys-front.jpg,Jolly Jerry's,Rum,,,40% Alc/Vol (80 Proof),750 mL,Sea Trader Imports,\"Miami, FL\",Product of Barbados\n" +
                    "granite-peak-front.jpg,Granite Peak,India Pale Ale,,,6.5% Alc/Vol,12 FL OZ,Granite Peak Brewing Co.,\"Portland, OR\",\n" +
                    "bayou-spiced-front.jpg,Bayou,,Spiced Rum,Rum with natural flavors added,35% Alc/Vol (70 Proof),750 mL,Bayou Spirits Co.,\"New Orleans, LA\",\n",
                )
              }
            >
              Download CSV template
            </button>
            {claimed.size > 0 && (
              <span className="text-sm text-ink-muted">
                {claimed.size} application row(s) loaded. Matched products get an Approve / Needs review /
                Reject verdict once the row carries a brand (plus alcohol content where TTB requires it
                for the type).
              </span>
            )}
          </div>
        </div>

        {error && <ErrorAlert>{error}</ErrorAlert>}

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void process()} disabled={running} className={`${primaryButtonClass} text-lg`}>
            {running ? "Reading…" : "Read all labels"}
          </button>
          <button type="button" onClick={exportJson} disabled={completedRows.length === 0} className={secondaryButtonClass}>
            Download JSON
          </button>
          <button type="button" onClick={exportCsv} disabled={completedRows.length === 0} className={secondaryButtonClass}>
            Download CSV
          </button>
        </div>

        {rows.length > 0 && (
          <p aria-live="polite" className="text-sm font-medium text-ink-muted">
            Read {done} / {rows.length}
          </p>
        )}

        {noneMatched && (
          <p className="rounded-card border-l-4 border-review-500 bg-review-50 p-3 text-sm text-review-900">
            Loaded {claimed.size} application row{claimed.size === 1 ? "" : "s"}, but none matched your
            files. Check that the CSV <code>filename</code> column matches your image filenames exactly
            (e.g. <code>acme-ipa-front.jpg</code>), or use the product name.
          </p>
        )}
      </div>

      {decidedCount > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-surface-muted p-3 text-sm">
          <span className="font-semibold text-ink">Worklist</span>
          <span className="inline-flex items-center gap-1.5 text-pass-700">
            <IconPass className="h-4 w-4" /> {approvedCount} approved
          </span>
          <span className="inline-flex items-center gap-1.5 text-fail-700">
            <IconFail className="h-4 w-4" /> {returnedCount} returned
          </span>
          <span className="text-ink-muted">{completedRows.length - decidedCount} not yet decided</span>
          <button
            type="button"
            onClick={clearWorklist}
            className="ml-auto rounded-field border-2 border-border-strong px-3 py-1.5 font-semibold text-ink transition hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            Clear worklist
          </button>
          <span className="w-full text-xs text-ink-muted">Decisions are saved in this browser only and never transmitted.</span>
        </div>
      )}

      {rows.length > 0 && (
        <div
          tabIndex={0}
          role="region"
          aria-label="Batch extraction results"
          className="mt-5 max-h-[32rem] overflow-auto rounded-card border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Batch extraction results</caption>
            <thead>
              <tr className="text-ink-muted">
                {COLS.map((h) => (
                  <th key={h} scope="col" className="sticky top-0 z-10 border-b-2 border-border bg-surface px-3 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const verdict = effectiveVerdictOf(r);
                const decision = worklist.worklist[r.product]?.decision;
                const canReview = r.status === "done" && r.readable === true && r.combined != null;
                return (
                  <tr key={`${r.product}-${i}`} className="border-b border-border align-top odd:bg-surface-muted hover:bg-brand-50">
                    <td className="px-3 py-2.5 text-ink">
                      <span className="font-mono text-xs">{r.product}</span>
                      <span className="block text-xs text-ink-muted">
                        {r.imageCount} image{r.imageCount === 1 ? "" : "s"}
                      </span>
                      {r.note && <span className="mt-0.5 block text-ink-muted">{r.note}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-ink">
                      {r.completeness ? CLASS_DISPLAY_LABEL[r.completeness.beverageClass] : r.status === "pending" ? "…" : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-ink">{cell(r, (e) => e.brand)}</td>
                    <td className="px-3 py-2.5 text-ink">{cell(r, (e) => e.alcoholContentText)}</td>
                    <td className="px-3 py-2.5">
                      {r.completeness ? (
                        <StatusBadge
                          tone={COMPLETENESS_TONE[r.completeness.overall]}
                          label={COMPLETENESS_LABEL[r.completeness.overall]}
                        />
                      ) : (
                        <span className="text-ink-muted">{r.status === "pending" ? "…" : "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {verdict ? (
                        <StatusBadge tone={toneForStatus(verdict)} label={VERDICT_LABEL[verdict]} />
                      ) : r.matchedClaim && r.readable === false ? (
                        <span className="text-sm text-review-700">Matched, couldn&apos;t read label; re-scan</span>
                      ) : r.matchedClaim && r.claimedNeeds ? (
                        <span className="text-sm text-review-700">Matched, add {r.claimedNeeds} to compare</span>
                      ) : (
                        <span className="text-ink-muted">{claimed.size > 0 ? "no application row" : "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {decision ? (
                        <StatusBadge tone={DECISION_CHIP[decision].tone} label={DECISION_CHIP[decision].label} />
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {canReview ? (
                        <button
                          type="button"
                          onClick={() => setReviewIndex(i)}
                          className="inline-flex min-h-[36px] items-center rounded-field border border-brand-600 bg-surface px-3 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                        >
                          {decision ? "Re-review" : "Review"}
                        </button>
                      ) : (
                        <span className="text-ink-muted">{r.status === "pending" ? "…" : "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {reviewIndex !== null &&
        rows[reviewIndex] &&
        (() => {
          const r = rows[reviewIndex];
          const rec = worklist.worklist[r.product];
          return (
            <Drawer open onClose={() => setReviewIndex(null)} title={`Review · ${r.product}`}>
              <ProductReview
                brand={r.extracted?.brand ?? r.product}
                images={r.images ?? []}
                combined={r.combined ?? null}
                readable={r.readable ?? false}
                unreadableMessage={r.note}
                overrides={rec?.overrides ?? {}}
                onOverride={(key, value) =>
                  worklist.setOverrides(r.product, toggleOverride(rec?.overrides ?? {}, key, value))
                }
                notes={rec?.notes ?? {}}
                onNote={(key, text) => worklist.setNotes(r.product, setFieldNote(rec?.notes ?? {}, key, text))}
                decision={rec?.decision}
                note={rec?.note}
                onRecordDecision={(decision, note) => worklist.recordDecision(r.product, decision, note)}
              />
            </Drawer>
          );
        })()}

      <ImageLightbox
        open={zoom !== null}
        src={zoom?.src ?? ""}
        alt={zoom?.alt ?? ""}
        onClose={() => setZoom(null)}
      />
    </section>
  );
}
