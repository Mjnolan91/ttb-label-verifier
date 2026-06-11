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
import { useId, useMemo, useRef, useState } from "react";
import type { ExtractedFields } from "@/domain";
import type { CompletenessResult } from "@/compare";
import type { LabelPosition } from "@/extraction";
import { groupImagesByProduct } from "@/batch/pairing";
import { analysisToCsv, parseClaimedCsv, type ClaimedRow } from "@/batch/csv";
import { resolveClaimedFor } from "@/batch/claimedMatch";
import { normalizeText, resolveCompletenessOverall, type VerifyResult } from "@/compare";
import type { VerifyApiResponse, VerifyApiError } from "../api/verify/contract";
import type { ImageReadFailure } from "@/pipeline";
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
import { deriveLabelReview, toggleOverride, setFieldNote, capVerdictForPartialRead } from "../ui/labelReview";
import { createPacer, isRetryableStatus, retryDelayMs, MAX_READ_ATTEMPTS, type Pacer } from "./pacing";
import type { AppInputKey } from "../ui/fieldHelpCopy";
import { applicationFromCsv, deriveProductVerdict, mergeApplication, type ProductVerdict } from "./productVerdict";
import { useWorklist } from "./useWorklist";
import { IconZoom } from "../ui/icons";

// Rows in flight at once. Cost-neutral throughput lever: concurrency changes WHEN the same model
// calls happen, never how many. At 8, the steady-state upstream rate (~9-12 calls per ~4.5s row)
// sits far inside a paid OpenAI tier's request limits; the AIMD pacer below discovers any tighter
// token-per-minute ceiling via costless 429s and converges near it.
const CONCURRENCY = 8;

// Downscaling is main-thread canvas work (decode + draw + encode), so cache it per File: a retry,
// re-read, or combine never redoes it, and the cache is warmed BEFORE taking a pacer slot so CPU
// work stops occupying read concurrency. Same function, same filename: the uploaded bytes are
// identical, so model inputs and the filename-keyed mock are untouched.
const downscaleCache = new WeakMap<File, Promise<File>>();
function downscaleCached(file: File): Promise<File> {
  let pending = downscaleCache.get(file);
  if (!pending) {
    pending = downscaleForUpload(file);
    downscaleCache.set(file, pending);
  }
  return pending;
}

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
  /** The product's label image previews (front first), for the row thumbnails + review drawer. */
  images?: { src: string; alt: string; position?: LabelPosition }[];
  /** The matched application CSV row (null when none) — the BASE the reviewer's drawer edits
   *  overlay. The verdict itself is NOT cached here: it derives at render (deriveProductVerdict)
   *  from this row + the worklist edits, so the table, the drawer, and the exports can't diverge. */
  claimedRow?: ClaimedRow | null;
  /** Whether the label itself was readable (drives the re-scan vs. add-claim-value prompts). */
  readable?: boolean;
  note?: string;
  /** Images of the product that dropped out of the read (partial read): caps the derived verdict at
   *  review, surfaces in the drawer + exports, and earns the row a Retry action. */
  imageFailures?: ImageReadFailure[];
}

/** Merge a source group's images into a target group, demoting duplicate positions to the first
 *  open one (front -> back -> neck -> other) so a two-front merge reads as front + back. */
function mergePositions(target: ProductImages, source: ProductImages): ProductImages {
  const taken = new Set(target.images.map((im) => im.position));
  const order: LabelPosition[] = ["front", "back", "neck", "other"];
  const images = [...target.images];
  for (const im of source.images) {
    const position = !taken.has(im.position) ? im.position : (order.find((p) => !taken.has(p)) ?? "other");
    taken.add(position);
    images.push({ file: im.file, position });
  }
  return { product: target.product, images };
}

/** Filename grouping, then the reviewer's explicit combine overrides (source product key ->
 *  target product key, lowercased) folded in. Deterministic and human-confirmed by design:
 *  a fuzzy auto-merge that guessed wrong would contaminate two products' verdicts. */
function groupFiles(files: File[], overrides: Record<string, string> = {}): ProductImages[] {
  const byName = new Map(files.map((f) => [f.name, f]));
  const base = groupImagesByProduct(files.map((f) => f.name)).map((g) => ({
    product: g.product,
    images: g.images.map((im) => ({ file: byName.get(im.filename) as File, position: im.position })),
  }));
  if (Object.keys(overrides).length === 0) return base;
  const merged = new Map<string, ProductImages>();
  const order: string[] = [];
  for (const g of base) {
    let key = g.product.toLowerCase();
    const seen = new Set([key]);
    while (overrides[key] && !seen.has(overrides[key])) {
      key = overrides[key];
      seen.add(key);
    }
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { product: g.product, images: [...g.images] });
      order.push(key);
    } else {
      const combined = mergePositions(existing, g);
      // The TARGET product's own name wins the display key, whichever side arrived first.
      merged.set(key, g.product.toLowerCase() === key ? { ...combined, product: g.product } : combined);
    }
  }
  return order.map((k) => merged.get(k) as ProductImages);
}

/** Human name for a failed image's slot in the partial-read row note. */
const POSITION_LABEL: Record<string, string> = {
  front: "Front label",
  back: "Back label",
  neck: "Neck / strip label",
};

/** Display order for a product's images: the front leads, then back/neck/other. */
const POSITION_RANK: Record<LabelPosition, number> = { front: 0, back: 1, neck: 2, other: 3 };
function byPosition<T extends { position: LabelPosition }>(images: T[]): T[] {
  return [...images].sort((a, b) => POSITION_RANK[a.position] - POSITION_RANK[b.position]);
}

/** Row note for a PARTIAL read (some of the product's images dropped out of the merge): the row
 *  stays reviewable, but the reviewer must know the extracted fields are honest-but-incomplete. */
function partialReadNote(failures: ImageReadFailure[]): string {
  const names = failures.map((f) => (f.position && POSITION_LABEL[f.position]) || f.filename);
  const timedOut = failures.every((f) => f.reason === "timeout");
  const plural = failures.length > 1 ? "images" : "image";
  return `${names.join(" and ")} ${plural} couldn't be read${timedOut ? " (the read timed out)" : ""}; the results reflect the remaining images.`;
}

async function analyzeOnce(
  group: ProductImages,
  claimedMap: Map<string, ClaimedRow>,
  previewByName: Map<string, string>,
): Promise<{ row: BatchRow; retryable: boolean }> {
  const images = byPosition(group.images).map((im) => ({
    src: previewByName.get(im.file.name) ?? "",
    alt: im.file.name,
    position: im.position,
  }));
  const base: BatchRow = { product: group.product, imageCount: group.images.length, status: "error", images };
  try {
    const form = new FormData();
    for (const img of group.images) {
      form.append("image", await downscaleCached(img.file));
      form.append("position", img.position);
    }
    const res = await fetch("/api/verify", { method: "POST", body: form });
    const json: VerifyApiResponse | VerifyApiError = await res.json();
    if (!res.ok) {
      // Throttling/transient gateway failures are worth retrying; validation 4xx and the 500
      // "reader not configured" operator error must surface immediately.
      return { row: { ...base, note: (json as VerifyApiError).error }, retryable: isRetryableStatus(res.status) };
    }
    const r = json as VerifyApiResponse;
    // Attach the matched application CSV row (by image filename or product stem). The verdict is NOT
    // computed here: it derives at render from this row + the reviewer's drawer edits (one shared
    // derivation — deriveProductVerdict — for the table, the drawer, and the exports).
    const claimedRow =
      resolveClaimedFor(
        { product: group.product, images: group.images.map((im) => ({ filename: im.file.name, position: im.position })) },
        claimedMap,
      ) ?? null;
    const failNote = r.imageFailures && r.imageFailures.length > 0 ? partialReadNote(r.imageFailures) : undefined;
    return {
      row: {
        ...base,
        status: "done",
        extracted: r.extracted,
        completeness: r.completeness,
        claimedRow,
        readable: r.readable,
        note: r.readable ? failNote : r.message,
        imageFailures: r.imageFailures,
      },
      retryable: false,
    };
  } catch {
    // A thrown fetch / non-JSON body is the network or the platform's own error page — transient.
    return { row: { ...base, note: "Request failed." }, retryable: true };
  }
}

/**
 * One product read with BOUNDED persistence: transient failures (429/502/503/504/network) retry up
 * to MAX_READ_ATTEMPTS with full-jitter backoff, pacing the whole pool down through the shared
 * pacer; everything else surfaces immediately. The row narrates each wait ("Service busy,
 * retrying...") and the terminal state stays honest — the manual Retry button is the escape hatch.
 */
async function analyzeProductWithRetry(
  group: ProductImages,
  claimedMap: Map<string, ClaimedRow>,
  previewByName: Map<string, string>,
  pacer: Pacer,
  onRetryNote: (note: string) => void,
): Promise<BatchRow> {
  let last: BatchRow | null = null;
  // Warm the downscale cache off the paced slot (parallel per image; identical bytes either way),
  // so the slot is spent on the network call, not on canvas CPU work.
  await Promise.all(group.images.map((im) => downscaleCached(im.file)));
  for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
    await pacer.acquire();
    let out: { row: BatchRow; retryable: boolean };
    try {
      out = await analyzeOnce(group, claimedMap, previewByName);
    } finally {
      pacer.release();
    }
    last = out.row;
    if (out.row.status !== "error") {
      pacer.reportSuccess();
      return out.row;
    }
    if (!out.retryable) return out.row;
    const delay = retryDelayMs(attempt);
    pacer.reportFailure(delay);
    if (attempt < MAX_READ_ATTEMPTS - 1) {
      onRetryNote(`Service busy, retrying (attempt ${attempt + 2} of ${MAX_READ_ATTEMPTS})…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return {
    ...(last as BatchRow),
    note: `Couldn't read after ${MAX_READ_ATTEMPTS} attempts. The reading service stayed busy. Use Retry to try again.`,
  };
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
  // The lightbox shows a SET of images (a product's front+back together — never just the front when
  // a reviewer is asked to confirm something on the label) opened at the clicked one.
  const [zoom, setZoom] = useState<{ images: { src: string; alt: string }[]; index: number } | null>(null);
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
  // Reviewer-confirmed combines (source product key -> target), folded into the derived grouping.
  // CLEARED whenever the image set changes: a stale override must never silently merge two
  // unrelated products that happen to reuse the same filenames in a later batch.
  const [groupOverrides, setGroupOverrides] = useState<Record<string, string>>({});
  // ONE row action (retry / sweep / combine) at a time, and none while a batch is running: the
  // worker writes and the grouping both assume the row set is stable underneath them.
  const [rowActionBusy, setRowActionBusy] = useState(false);
  // The combine drops both rows' review records, so it takes a deliberate second click.
  const [confirmCombine, setConfirmCombine] = useState<string | null>(null);
  // Polite announcement channel for row actions (combine/sweep), for screen-reader users.
  const [actionAnnounce, setActionAnnounce] = useState("");
  const resultsRegionRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupFiles(images.map((im) => im.file), groupOverrides), [images, groupOverrides]);
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
    // A partial read (an image dropped out) caps the derived verdict at review: the unread image
    // could contradict anything, so it must never badge Approve or triage as ready-to-approve.
    const verdict = capVerdictForPartialRead(
      review?.effectiveOverall ?? null,
      (r.imageFailures?.length ?? 0) > 0,
    );
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

  /** The core re-read of one product, addressed BY PRODUCT (row indices shift when rows merge, so
   *  by-index writes can clobber the wrong row). The callers own the mutual-exclusion guard. */
  async function reReadProduct(product: string) {
    const group = groups.find((g) => g.product === product);
    if (!group) return;
    setRows((prev) =>
      prev.map((p) => (p.product === product ? { product, imageCount: group.images.length, status: "pending" } : p)),
    );
    const pacer = createPacer({ start: 1, min: 1, max: 2 });
    const next = await analyzeProductWithRetry(group, claimed, previewByName, pacer, (note) =>
      setRows((prev) => prev.map((p) => (p.product === product ? { ...p, note } : p))),
    );
    // A re-read REPLACES the extraction: every confirm/flag and any recorded decision was made
    // against the old read, so none of it may survive onto the new one (the same fresh-read-
    // invalidates rule application edits follow — a stale "Approved" force-passing a recomputed
    // comparison is a false approval).
    worklist.invalidateReview(product);
    setRows((prev) => prev.map((p) => (p.product === product ? next : p)));
  }

  /** Re-read ONE failed or partially-read product without re-running the whole batch. */
  async function retryProduct(product: string) {
    if (running || rowActionBusy) return;
    setRowActionBusy(true);
    try {
      await reReadProduct(product);
    } finally {
      setRowActionBusy(false);
    }
  }

  /** Re-run every terminal-error row, one at a time (the gentlest pace after a rough run). */
  async function retryAllFailed() {
    if (running || rowActionBusy) return;
    setRowActionBusy(true);
    try {
      const products = rows.filter((r) => r.status === "error").map((r) => r.product);
      for (const p of products) await reReadProduct(p);
      setActionAnnounce(`Retried ${products.length} failed ${products.length === 1 ? "product" : "products"}.`);
      resultsRegionRef.current?.focus();
    } finally {
      setRowActionBusy(false);
    }
  }

  /** Two rows the reviewer confirmed are ONE product: fold the groups, drop both rows' review
   *  records (fresh read invalidates), and re-read the merged set as one product. */
  async function combineRows(sourceProduct: string, targetProduct: string) {
    if (running || rowActionBusy) return;
    const sourceGroup = groups.find((g) => g.product === sourceProduct);
    const targetGroup = groups.find((g) => g.product === targetProduct);
    if (!sourceGroup || !targetGroup) return;
    setRowActionBusy(true);
    setConfirmCombine(null);
    setActionAnnounce(`Combining ${sourceProduct} into ${targetProduct} and re-reading as one product.`);
    try {
      setGroupOverrides((prev) => ({ ...prev, [sourceProduct.toLowerCase()]: targetProduct.toLowerCase() }));
      worklist.reset(sourceProduct);
      worklist.invalidateReview(targetProduct);
      const merged = mergePositions(targetGroup, sourceGroup);
      setRows((prev) =>
        prev
          .filter((p) => p.product !== sourceProduct)
          .map((p) =>
            p.product === targetProduct
              ? { product: targetProduct, imageCount: merged.images.length, status: "pending" as const }
              : p,
          ),
      );
      const pacer = createPacer({ start: 1, min: 1, max: 2 });
      const row = await analyzeProductWithRetry(merged, claimed, previewByName, pacer, (note) =>
        setRows((prev) => prev.map((p) => (p.product === targetProduct ? { ...p, note } : p))),
      );
      setRows((prev) => prev.map((p) => (p.product === targetProduct ? row : p)));
      setActionAnnounce(`Combined into ${targetProduct}: one product with ${merged.images.length} images.`);
      resultsRegionRef.current?.focus();
    } finally {
      setRowActionBusy(false);
    }
  }

  /** The earlier settled, readable row sharing this row's normalized brand (a combine candidate),
   *  bounded by the API's four-images-per-product cap. */
  function combineTargetFor(row: BatchRow, index: number): BatchRow | undefined {
    if (row.status !== "done" || !row.readable || !row.extracted?.brand) return undefined;
    const brandKey = normalizeText(row.extracted.brand);
    if (!brandKey) return undefined;
    return rows.find(
      (other, i) =>
        i < index &&
        other.product !== row.product &&
        other.status === "done" &&
        other.readable === true &&
        other.extracted?.brand !== undefined &&
        normalizeText(other.extracted.brand) === brandKey &&
        other.imageCount + row.imageCount <= 4,
    );
  }

  function addFiles(newFiles: File[]) {
    setImages((prev) => [...prev, ...newFiles.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
    // Adding images satisfies the "add images" validation; a stale error banner over a now-valid
    // form reads as broken. (Other errors, e.g. a rejected CSV, are unrelated to this action.)
    setError((prev) => (prev === ADD_IMAGES_ERROR ? null : prev));
    // A changed image set is a NEW grouping problem: stale combines must not survive onto it.
    setGroupOverrides({});
    setConfirmCombine(null);
  }
  function removeImage(index: number) {
    setImages((prev) => {
      const target = prev[index];
      if (target) {
        if (zoom?.images.some((zi) => zi.src === target.preview)) setZoom(null);
        URL.revokeObjectURL(target.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
    setGroupOverrides({});
    setConfirmCombine(null);
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
    // ONE pacer per run: any transient failure anywhere in the pool HALVES the in-flight target
    // and opens a bounded cooldown; sustained success ramps it back toward CONCURRENCY.
    const pacer = createPacer({ start: 4, min: 1, max: CONCURRENCY });
    const worker = async (workerIndex: number) => {
      // Stagger worker starts so the per-product request bursts don't align at t=0. Flat jitter:
      // scaling the delay by worker index gave the last worker ~2s of dead time at 8 workers.
      if (workerIndex > 0) await new Promise((r) => setTimeout(r, workerIndex * 100 + Math.random() * 200));
      while (next < groups.length) {
        const idx = next++;
        const product = groups[idx].product;
        // All row writes are BY PRODUCT, never by index: indices shift when rows merge or filter,
        // and a by-index write from an in-flight worker would clobber the wrong row.
        const row = await analyzeProductWithRetry(groups[idx], claimed, previewByName, pacer, (note) =>
          setRows((prev) => prev.map((p) => (p.product === product ? { ...p, note } : p))),
        );
        setRows((prev) => prev.map((p) => (p.product === product ? row : p)));
        completed++;
        setDone(completed);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, groups.length) }, (_, i) => worker(i)));
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
          // The audit record must carry the partial-read fact: without it a saved approval over a
          // dropped image reads as a clean read of every uploaded image.
          ...(r.imageFailures?.length ? { imageFailures: r.imageFailures } : {}),
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
            readFailures: r.imageFailures?.length ? partialReadNote(r.imageFailures) : undefined,
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
                {images.length} {images.length === 1 ? "image" : "images"} grouped into{" "}
                <strong className="text-ink">
                  {groups.length} {groups.length === 1 ? "product" : "products"}
                </strong>
                {groups.some((g) => g.images.length > 1) ? ", some paired front and back" : ""}
              </p>
              <ul className="mt-3 flex flex-wrap gap-3">
                {images.map((img, i) => (
                  <li key={`${img.file.name}-${i}`} className="relative">
                    <button
                      type="button"
                      onClick={() => setZoom({ images: [{ src: img.preview, alt: img.file.name }], index: 0 })}
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
                    ? "No usable rows found in that CSV. Each row needs a filename column matching an uploaded image; use the Download CSV template button above for the expected format."
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
                  // The first rows target the BUNDLED sample product (downloadable from the
                  // single screen's "No label handy?" links; fronts and backs pair by filename),
                  // so template + samples demo end to end — offline mock and live provider alike.
                  "filename,brand,class,fanciful,composition,alcohol,net,name,address,country\n" +
                    "fear-the-dragon-front.jpg,Fear the Dragon,Spirit Distilled from Grain and Pumpkin,,Spirit made from the mash of Flying Dog's The Fear,50% Alc./Vol. (100 Proof),750ML,\"Dragon Distillery, LLC\",\"Frederick, MD\",\n" +
                    "fear-the-dragon-warning-not-bold-back.jpg,Fear the Dragon,Spirit Distilled from Grain and Pumpkin,,Spirit made from the mash of Flying Dog's The Fear,50% Alc./Vol. (100 Proof),750ML,\"Dragon Distillery, LLC\",\"Frederick, MD\",\n" +
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
                {claimed.size} application {claimed.size === 1 ? "row" : "rows"} loaded. Matched products get an Approve / Needs review /
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

      {/* After a rough run, one click re-reads every terminal failure at the gentlest pace. */}
      {!running && rows.some((r) => r.status === "error") && (
        <p className="mt-4">
          <button
            type="button"
            onClick={() => void retryAllFailed()}
            disabled={rowActionBusy}
            className={secondaryButtonClass}
          >
            Retry all failed ({rows.filter((r) => r.status === "error").length})
          </button>
        </p>
      )}

      {/* Row actions (combine, retry sweep) announce here; focus moves to the results region when
          the acted-on control unmounts, so keyboard users are never dropped to the page body. */}
      <p role="status" aria-live="polite" className="sr-only">
        {actionAnnounce}
      </p>

      {rows.length > 0 && (
        <div
          ref={resultsRegionRef}
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
              <li className="px-3 py-4 text-ink-muted">No products in this view. Pick another filter above.</li>
            )}
            {visibleRows.map(({ r, i, d }) => {
              const { verdict, resolvedCompleteness, decision, category, pv, matchedClaim } = d;
              const settled = r.status !== "pending";
              // The row's thumbnails: EVERY image of the product, front first (the analyzed
              // previews when settled, else derived from the upload list so pending/retrying rows
              // show their images too) — a front/back pair reads as one product at a glance.
              const thumbs = (
                r.images && r.images.length > 0
                  ? r.images
                  : byPosition(groups.find((grp) => grp.product === r.product)?.images ?? []).map(
                      (im) => ({
                        src: previewByName.get(im.file.name) ?? "",
                        alt: im.file.name,
                        position: im.position as LabelPosition | undefined, // widen to match r.images
                      }),
                    )
              ).filter((t) => t.src !== "");
              const combineTarget = combineTargetFor(r, i);
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
                  {/* 1. Product identity (the only flexible track), led by thumbnails of the
                      product's images — front first, then back/neck — so a pair reads together
                      (derived from the upload previews for pending rows). */}
                  <div className="flex min-w-0 items-start gap-2.5 text-ink">
                    {thumbs.length > 0 && (
                      <div className="flex shrink-0 flex-wrap gap-1">
                        {thumbs.map((t, ti) => (
                          <button
                            key={t.alt}
                            type="button"
                            onClick={() =>
                              setZoom({ images: thumbs.map((x) => ({ src: x.src, alt: x.alt })), index: ti })
                            }
                            aria-label={`Show ${r.product} ${t.position ? `${t.position} ` : ""}label larger`}
                            title={t.position ? POSITION_LABEL[t.position] ?? t.position : undefined}
                            className="h-12 w-12 cursor-zoom-in overflow-hidden rounded-field border border-border bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                          >
                            {/* object-contain: a tall strip label must stay recognizable, not crop to a sliver */}
                            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                            <img src={t.src} alt="" className="h-full w-full object-contain" />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="block break-all font-mono text-xs">{r.product}</span>
                      {r.extracted?.brand && <span className="block text-sm font-medium">{r.extracted.brand}</span>}
                      <span className="block text-xs text-ink-muted">{settled ? meta : "…"}</span>
                      {r.note && <span className="mt-0.5 block text-sm text-ink-muted">{r.note}</span>}
                      {combineTarget &&
                        /* Two rows read the same brand: offer a deterministic, human-confirmed merge
                           (camera filenames defeat pairing; a silent auto-merge could contaminate
                           two different products). It drops both rows' review records, so it takes
                           a deliberate second click. */
                        (confirmCombine === r.product ? (
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-ink">
                              Re-reads both as one product and clears their reviews.
                            </span>
                            <button
                              type="button"
                              onClick={() => void combineRows(r.product, combineTarget.product)}
                              disabled={running || rowActionBusy}
                              className="min-h-[36px] rounded-field border border-brand-600 bg-brand-600 px-2.5 text-xs font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:opacity-50"
                            >
                              Confirm combine
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmCombine(null)}
                              className="min-h-[36px] rounded-field border border-border-strong px-2.5 text-xs font-semibold text-ink transition hover:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmCombine(r.product)}
                            disabled={running || rowActionBusy}
                            className="mt-1 min-h-[36px] rounded-field border border-brand-600 px-2.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:opacity-50"
                          >
                            Same brand as {combineTarget.product}. Combine and re-read
                          </button>
                        ))}
                    </div>
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
                          <span className="mt-1 block text-xs text-review-900">
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
                  {/* 4. Action: every settled row has one (review or retry); 44px target, full width
                      on mobile. A PARTIAL read (an image dropped out) gets BOTH: re-read to recover
                      the missing image, or review what survived. */}
                  <div className="flex flex-col gap-1.5">
                    {!settled ? (
                      <span className="text-ink-muted">…</span>
                    ) : (
                      <>
                        {(r.status === "error" || (r.imageFailures?.length ?? 0) > 0) && (
                          <button
                            type="button"
                            onClick={() => void retryProduct(r.product)}
                            disabled={running || rowActionBusy}
                            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-field border border-brand-600 bg-surface px-3 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto"
                          >
                            Retry
                          </button>
                        )}
                        {r.status !== "error" && (
                          <button
                            type="button"
                            onClick={() => setReviewIndex(i)}
                            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-field border border-brand-600 bg-surface px-3 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 sm:w-auto"
                          >
                            {decision ? "Re-review" : "Review"}
                          </button>
                        )}
                      </>
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
                partialReadNote={r.imageFailures?.length ? r.note : undefined}
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
        images={zoom?.images ?? []}
        initialIndex={zoom?.index ?? 0}
        onClose={() => setZoom(null)}
      />
    </section>
  );
}
