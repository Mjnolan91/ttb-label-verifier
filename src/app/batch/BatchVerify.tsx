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
import type { CompletenessResult } from "@/compare";
import type { LabelPosition } from "@/extraction";
import { groupImagesByProduct } from "@/batch/pairing";
import { analysisToCsv, parseClaimedCsv, type ClaimedRow } from "@/batch/csv";
import { resolveClaimedFor } from "@/batch/claimedMatch";
import { resolveCompletenessOverall, type VerifyResult } from "@/compare";
import type { VerifyApiResponse, VerifyApiError } from "../api/verify/contract";
import { downscaleForUpload } from "../imageDownscale";
import { ErrorAlert } from "../ui/ErrorAlert";
import { StatusBadge } from "../ui/StatusBadge";
import { toneForStatus, TONE_TINT, VERDICT_LABEL, type Tone } from "../ui/status";
import { CLASS_DISPLAY_LABEL } from "../ui/beverageClass";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "../ui/fieldStyles";
import { downloadJson, downloadCsv } from "../ui/download";
import { DropZone } from "../ui/DropZone";
import { ImageLightbox } from "../ui/ImageLightbox";
import { Drawer } from "../ui/Drawer";
import { ProductReview } from "../ui/ProductReview";
import { deriveLabelReview, toggleOverride, setFieldNote } from "../ui/labelReview";
import type { AppInputKey } from "../ui/fieldHelpCopy";
import { applicationFromCsv, deriveProductVerdict, mergeApplication, type ProductVerdict } from "./productVerdict";
import { useWorklist } from "./useWorklist";
import { IconZoom } from "../ui/icons";

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
  /** The product's label image previews, for the review drawer. */
  images?: { src: string; alt: string }[];
  /** The matched application CSV row (null when none) — the BASE the reviewer's drawer edits
   *  overlay. The verdict itself is NOT cached here: it derives at render (deriveProductVerdict)
   *  from this row + the worklist edits, so the table, the drawer, and the exports can't diverge. */
  claimedRow?: ClaimedRow | null;
  /** Whether the label itself was readable (drives the re-scan vs. add-claim-value prompts). */
  readable?: boolean;
  note?: string;
}

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
    // Attach the matched application CSV row (by image filename or product stem). The verdict is NOT
    // computed here: it derives at render from this row + the reviewer's drawer edits (one shared
    // derivation — deriveProductVerdict — for the table, the drawer, and the exports).
    const claimedRow =
      resolveClaimedFor(
        { product: group.product, images: group.images.map((im) => ({ filename: im.file.name, position: im.position })) },
        claimedMap,
      ) ?? null;
    return {
      ...base,
      status: "done",
      extracted: r.extracted,
      completeness: r.completeness,
      claimedRow,
      readable: r.readable,
      note: r.readable ? undefined : r.message,
    };
  } catch {
    return { ...base, note: "Request failed." };
  }
}

const ADD_IMAGES_ERROR = "Add one or more label images.";

/** Triage category for one row — drives the roll-up chips, the filter, the sort and the row tint. */
type RowCategory = "pending" | "attention" | "approve" | "notVerified" | "decided";
const CATEGORY_RANK: Record<RowCategory, number> = {
  attention: 0,
  pending: 1,
  notVerified: 2,
  approve: 3,
  decided: 4,
};

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
  // Triage filter, driven by the roll-up chips ("all" shows everything).
  const [filter, setFilter] = useState<"all" | RowCategory>("all");

  const groups = useMemo(() => groupFiles(images.map((im) => im.file)), [images]);
  const previewByName = useMemo(() => new Map(images.map((im) => [im.file.name, im.preview])), [images]);

  /** Everything the table derives per row, override-aware (parity with the single screen): the
   *  effective application + verdict (CSV row overlaid with drawer edits — deriveProductVerdict, the
   *  ONE derivation the drawer and exports also read), the override-resolved completeness, the
   *  recorded decision, and the triage category. */
  function derivedOf(r: BatchRow): {
    verdict: VerifyResult["overall"] | null;
    resolvedCompleteness: CompletenessResult["overall"] | null;
    decision: "approve" | "reject" | undefined;
    category: RowCategory;
    pv: ProductVerdict;
    matchedClaim: boolean;
  } {
    const rec = worklist.worklist[r.product];
    const pv =
      r.status === "done"
        ? deriveProductVerdict(mergeApplication(r.claimedRow, rec?.application), r.extracted, r.readable ?? false)
        : { combined: null, application: null };
    const review = pv.combined ? deriveLabelReview(pv.combined, rec?.overrides ?? {}) : null;
    const resolvedCompleteness = pv.combined
      ? resolveCompletenessOverall(pv.combined.completeness, review?.completenessOverrides ?? {})
      : null;
    const verdict = review?.effectiveOverall ?? null;
    const decision = rec?.decision;
    const category: RowCategory =
      r.status === "pending"
        ? "pending"
        : decision
          ? "decided"
          : r.status === "error" || r.readable === false || verdict === "review" || verdict === "reject" || pv.claimedNeeds
            ? "attention"
            : verdict === "approve"
              ? "approve"
              : resolvedCompleteness !== null && resolvedCompleteness !== "complete"
                ? "attention"
                : "notVerified";
    return { verdict, resolvedCompleteness, decision, category, pv, matchedClaim: Boolean(r.claimedRow) };
  }

  /** Record one application-value edit from the drawer. The edit overlays the CSV row (an explicit ""
   *  clears a wrong CSV value), and it INVALIDATES the reviewer's prior review of this product — every
   *  confirm/flag call AND any recorded decision, not just the edited field's: comparison cards depend
   *  on OTHER inputs (the claimed class/type SELECTS the alcohol tolerance band; a completeness-only
   *  "ok" maps onto the comparison card once the gate first passes), so a stale "ok" or a stale
   *  "Approved" can force-pass a comparison the reviewer never saw — a false approval. The single
   *  screen's fresh-read-drops-overrides principle, applied here; the row returns to Undecided. */
  function applyApplicationEdit(product: string, key: AppInputKey, value: string) {
    // Both mutators are FUNCTIONAL (merge / replace against the latest state), so the several calls
    // one "Accept all" click fires accumulate instead of last-write-wins on a stale snapshot.
    worklist.setApplication(product, { [key]: value });
    worklist.invalidateReview(product);
  }

  /** Re-read ONE failed product without re-running the whole batch. */
  async function retryRow(index: number) {
    const row = rows[index];
    const group = groups.find((g) => g.product === row?.product);
    if (!row || !group) return;
    setRows((prev) => prev.map((p, i) => (i === index ? { product: p.product, imageCount: p.imageCount, status: "pending" } : p)));
    const next = await analyzeProduct(group, claimed, previewByName);
    setRows((prev) => prev.map((p, i) => (i === index ? next : p)));
  }

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
  const noneMatched = !running && rows.length > 0 && claimed.size > 0 && rows.every((r) => !r.claimedRow);
  function exportJson() {
    downloadJson(
      "ttb-extractions.json",
      completedRows.map((r) => {
        const rec = worklist.worklist[r.product];
        const d = derivedOf(r);
        const result = d.pv.combined?.verify ?? null;
        const overall = d.verdict ?? null;
        return {
          product: r.product,
          extracted: r.extracted,
          completeness: r.completeness,
          // The application of record the verdict used (CSV row overlaid with the reviewer's edits),
          // plus the raw edits separately — so "why was this rejected?" stays reproducible.
          ...(d.pv.application ? { claimed: d.pv.application } : {}),
          ...(rec?.application && Object.keys(rec.application).length ? { applicationEdits: rec.application } : {}),
          // Mirror the single-screen JSON: carry the (override-aware) verdict so JSON and CSV agree.
          ...(result ? { result } : {}),
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
          const d = derivedOf(r);
          return {
            filename: r.product,
            extracted: r.extracted as ExtractedFields,
            completeness: r.completeness,
            result: d.pv.combined?.verify ?? null,
            overall: d.verdict ?? undefined,
            decision: rec?.decision,
            note: rec?.note,
          };
        }),
      ),
    );
  }

  // One shared grid template so the legend and every row stay column-aligned on sm+. Four priority
  // tracks (Product | Result | Decision | Review) — the long tail (type, brand, alcohol) lives in
  // the product identity stack and the review drawer, so the list NEVER scrolls sideways.
  const ROW_GRID = "sm:grid-cols-[minmax(0,1fr)_10.5rem_6.5rem_7rem] sm:gap-x-3";

  // Triage roll-up: every row categorized (override-aware), for the chips + filter + sort.
  const derivedRows = rows.map((r, i) => ({ r, i, d: derivedOf(r) }));
  const countOf = (c: RowCategory) => derivedRows.filter((e) => e.d.category === c).length;
  const counts = {
    attention: countOf("attention"),
    approve: countOf("approve"),
    notVerified: countOf("notVerified"),
    decided: countOf("decided"),
  };
  const decidedCount = counts.decided;
  const visibleRows = derivedRows
    .filter((e) => filter === "all" || e.d.category === filter)
    .sort((a, b) => CATEGORY_RANK[a.d.category] - CATEGORY_RANK[b.d.category] || a.i - b.i);

  const CHIPS: { key: "all" | RowCategory; label: string; count: number; tone: Tone }[] = [
    { key: "all", label: "All", count: rows.length, tone: "neutral" },
    { key: "attention", label: "Needs attention", count: counts.attention, tone: "review" },
    { key: "approve", label: "Ready to approve", count: counts.approve, tone: "pass" },
    { key: "notVerified", label: "Not verified", count: counts.notVerified, tone: "verify" },
    { key: "decided", label: "Decided", count: counts.decided, tone: "neutral" },
  ];

  function clearWorklist() {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Clear all recorded decisions, resolved flags, and typed application values? This can't be undone.")
    ) {
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
        add or correct the application&apos;s values (the CSV is optional), resolve flagged fields,
        record an Approve or send-back, and draft the applicant email. Your decisions and typed values
        are saved in this browser and included in the export. Pair a front and back by naming
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
              (CSV, one row per product: filename, brand, class, fanciful, composition, alcohol, net,
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

      {rows.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface-muted p-3 text-sm">
          <span className="mr-1 font-semibold text-ink">Worklist</span>
          {CHIPS.filter((c) => c.key === "all" || c.count > 0).map((c) => {
            const selected = filter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setFilter(c.key)}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-pill border px-3 py-1 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${
                  selected ? `${TONE_TINT[c.tone]} ring-1 ring-inset ring-current` : "border-border bg-surface text-ink-muted hover:bg-brand-50"
                }`}
              >
                {c.label}
                <span className="rounded-pill bg-black/10 px-1.5 text-xs font-bold">{c.count}</span>
              </button>
            );
          })}
          {decidedCount > 0 && (
            <button
              type="button"
              onClick={clearWorklist}
              className="ml-auto rounded-field border-2 border-border-strong px-3 py-1.5 font-semibold text-ink transition hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              Clear worklist
            </button>
          )}
          <span className="w-full text-xs text-ink-muted">
            Sorted needs-attention first. Decisions and typed application values are saved in this
            browser only and never transmitted.
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <div
          tabIndex={0}
          role="region"
          aria-label="Batch extraction results"
          className="mt-5 max-h-[32rem] overflow-y-auto rounded-card border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          {/* Column legend, sm+ only; aria-hidden because each row carries its own sr-only labels. */}
          <div
            aria-hidden="true"
            className={`sticky top-0 z-10 hidden border-b-2 border-border bg-surface px-3 py-2.5 text-sm font-semibold text-ink-muted sm:grid ${ROW_GRID}`}
          >
            <span>Product</span>
            <span>Result</span>
            <span>Decision</span>
            <span>Review</span>
          </div>
          <ul className="divide-y divide-border text-sm">
            {visibleRows.length === 0 && (
              <li className="px-3 py-4 text-ink-muted">No products in this view. Pick another chip above.</li>
            )}
            {visibleRows.map(({ r, i, d }) => {
              const { verdict, resolvedCompleteness, decision, category, pv, matchedClaim } = d;
              const settled = r.status !== "pending";
              // Attention rows get a left accent + soft tint (red for hard failures, amber for the
              // rest); decided rows dim so the open remainder pops. State is never color-only: every
              // tinted row also carries a badge with an icon + label.
              const accent =
                category === "attention"
                  ? r.status === "error" || verdict === "reject"
                    ? "border-l-4 border-l-fail-600 bg-fail-50"
                    : "border-l-4 border-l-review-500 bg-review-50"
                  : category === "decided"
                    ? "opacity-75"
                    : "";
              const meta = [
                r.completeness ? CLASS_DISPLAY_LABEL[r.completeness.beverageClass] : null,
                r.extracted?.alcoholContentText?.trim() || null,
                `${r.imageCount} image${r.imageCount === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li
                  key={`${r.product}-${i}`}
                  className={`grid items-start gap-y-2 px-3 py-3 hover:bg-brand-50 sm:items-center ${ROW_GRID} ${accent}`}
                >
                  {/* 1. Product identity (the only flexible track) */}
                  <div className="min-w-0 text-ink">
                    <span className="block break-all font-mono text-xs">{r.product}</span>
                    {r.extracted?.brand && <span className="block text-sm font-medium">{r.extracted.brand}</span>}
                    <span className="block text-xs text-ink-muted">{settled ? meta : "…"}</span>
                    {r.note && <span className="mt-0.5 block text-sm text-ink-muted">{r.note}</span>}
                  </div>
                  {/* 2. Result (sr-only label is a SIBLING of the badge, never inside it) */}
                  <div className="min-w-0">
                    <span className="sr-only">Result: </span>
                    {!settled ? (
                      <span className="text-ink-muted">…</span>
                    ) : r.status === "error" ? (
                      <StatusBadge tone="fail" label="Read failed" />
                    ) : r.readable === false ? (
                      <>
                        <StatusBadge tone="review" label="Couldn't read" />
                        {matchedClaim && (
                          <span className="mt-1 block text-xs text-review-700">
                            Application matched. Upload a clearer image.
                          </span>
                        )}
                      </>
                    ) : verdict ? (
                      <StatusBadge tone={toneForStatus(verdict)} label={VERDICT_LABEL[verdict]} />
                    ) : pv.claimedNeeds ? (
                      <>
                        <StatusBadge tone="review" label="Add application values" />
                        <span className="mt-1 block text-xs text-review-700">
                          Add {pv.claimedNeeds} in Review to compare
                        </span>
                      </>
                    ) : (
                      <>
                        {resolvedCompleteness === "complete" ? (
                          <StatusBadge tone="verify" label="Label complete" />
                        ) : (
                          <StatusBadge
                            tone="review"
                            label={resolvedCompleteness === "incomplete" ? "Incomplete label" : "Check label"}
                          />
                        )}
                        <span className="mt-1 block text-xs text-ink-muted">
                          {claimed.size > 0 ? "No application row. Add values in Review." : "Add application values in Review to compare."}
                        </span>
                      </>
                    )}
                  </div>
                  {/* 3. Decision */}
                  <div className="min-w-0">
                    <span className="sr-only">Your decision: </span>
                    {decision ? (
                      <StatusBadge tone={DECISION_CHIP[decision].tone} label={DECISION_CHIP[decision].label} />
                    ) : settled ? (
                      <span className="inline-flex items-center rounded-pill border border-border-strong px-2 py-0.5 text-xs font-medium text-ink-muted">
                        Undecided
                      </span>
                    ) : (
                      <span className="text-ink-muted">…</span>
                    )}
                  </div>
                  {/* 4. Action: every settled row has one (review or retry); 44px target, full width on mobile */}
                  <div>
                    {!settled ? (
                      <span className="text-ink-muted">…</span>
                    ) : r.status === "error" ? (
                      <button
                        type="button"
                        onClick={() => void retryRow(i)}
                        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-field border border-brand-600 bg-surface px-3 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 sm:w-auto"
                      >
                        Retry
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReviewIndex(i)}
                        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-field border border-brand-600 bg-surface px-3 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 sm:w-auto"
                      >
                        {decision ? "Re-review" : "Review"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {reviewIndex !== null &&
        rows[reviewIndex] &&
        (() => {
          const r = rows[reviewIndex];
          const rec = worklist.worklist[r.product];
          const d = derivedOf(r);
          return (
            <Drawer open onClose={() => setReviewIndex(null)} title={`Review · ${r.product}`}>
              <ProductReview
                brand={r.extracted?.brand ?? r.product}
                images={r.images ?? []}
                combined={d.pv.combined}
                readable={r.readable ?? false}
                unreadableMessage={r.note}
                extracted={r.extracted}
                application={d.pv.application}
                csvValues={r.claimedRow ? applicationFromCsv(r.claimedRow) : null}
                edits={rec?.application ?? {}}
                onApplicationChange={(key, value) => applyApplicationEdit(r.product, key, value)}
                claimedNeeds={d.pv.claimedNeeds}
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
