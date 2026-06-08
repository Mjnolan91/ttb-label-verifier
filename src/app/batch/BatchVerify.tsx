"use client";

/**
 * BatchVerify — extraction-first batch screen with front/back pairing.
 *
 * Upload many label images; they're grouped into PRODUCTS by filename convention (acme-front.jpg +
 * acme-back.jpg -> one product, read together), the AI reads each product, and a per-product TTB
 * completeness verdict + extracted fields fill a table, exportable as JSON or CSV. A small pool keeps
 * the UI responsive on big batches.
 */
import { useId, useMemo, useState } from "react";
import type { BeverageClass, ExtractedFields } from "@/domain";
import type { CompletenessResult } from "@/compare";
import type { LabelPosition } from "@/extraction";
import { groupImagesByProduct } from "@/batch/pairing";
import { analysisToCsv, parseClaimedCsv, type ClaimedRow } from "@/batch/csv";
import { resolveClaimedFor } from "@/batch/claimedMatch";
import { verifyLabel, type VerifyResult } from "@/compare";
import type { VerifyApiResponse, VerifyApiError } from "../api/verify/contract";
import { downscaleForUpload } from "../imageDownscale";
import { ErrorAlert } from "../ui/ErrorAlert";
import { StatusBadge } from "../ui/StatusBadge";
import { toneForStatus, type Tone } from "../ui/status";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "../ui/fieldStyles";
import { downloadJson, downloadCsv } from "../ui/download";
import { DropZone } from "../ui/DropZone";
import { ImageLightbox } from "../ui/ImageLightbox";
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
  /** Application-match verdict, when an application-values CSV row matched this product. */
  result?: VerifyResult | null;
  note?: string;
}

const CLASS_LABEL: Record<BeverageClass, string> = {
  distilledSpirits: "Distilled spirits",
  wineUnder14: "Wine (≤14%)",
  wineOver14: "Wine (>14%)",
  maltBeverage: "Malt beverage",
  cider: "Cider",
  unknown: "Unknown",
};
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
): Promise<BatchRow> {
  const base: BatchRow = { product: group.product, imageCount: group.images.length, status: "error" };
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
    const result =
      claimedRow?.brand && r.readable
        ? verifyLabel(
            { brand: claimedRow.brand, alcoholContentText: claimedRow.alcoholContent, classType: claimedRow.classType },
            r.extracted,
          )
        : null;
    return {
      ...base,
      status: "done",
      extracted: r.extracted,
      completeness: r.completeness,
      result,
      note: r.readable ? undefined : r.message,
    };
  } catch {
    return { ...base, note: "Request failed." };
  }
}

function cell(row: BatchRow, pick: (e: ExtractedFields) => string | undefined): string {
  if (row.status === "pending") return "…";
  if (!row.extracted) return "—";
  const v = pick(row.extracted);
  return v && v.trim() !== "" ? v : "—";
}

export function BatchVerify() {
  const ids = { images: useId(), help: useId() };
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const [claimed, setClaimed] = useState<Map<string, ClaimedRow>>(new Map());
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupFiles(images.map((im) => im.file)), [images]);

  function addFiles(newFiles: File[]) {
    setImages((prev) => [...prev, ...newFiles.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
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
      setError("Add one or more label images.");
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
        const row = await analyzeProduct(groups[idx], claimed);
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
  function exportJson() {
    downloadJson(
      "ttb-extractions.json",
      completedRows.map((r) => ({
        product: r.product,
        extracted: r.extracted,
        completeness: r.completeness,
      })),
    );
  }
  function exportCsv() {
    downloadCsv(
      "ttb-extractions.csv",
      analysisToCsv(
        completedRows.map((r) => ({
          filename: r.product,
          extracted: r.extracted as ExtractedFields,
          completeness: r.completeness,
          result: r.result,
        })),
      ),
    );
  }

  const COLS = ["Product", "Type", "Brand", "Class / type", "Alcohol", "Completeness", "Application match"];

  return (
    <section className="rounded-card border border-border border-t-4 border-t-brand-600 bg-surface p-6 shadow-card sm:p-8">
      <h2 className="text-xl font-semibold text-ink">Batch read</h2>
      <p className="mt-1 text-ink-muted">
        Upload many label images — they&apos;re grouped into products and read into a table you can
        export. Pair a front and back by naming them alike with a suffix, e.g.{" "}
        <code>acme-ipa-front.jpg</code> + <code>acme-ipa-back.jpg</code>; a file with no suffix is its
        own single-label product.
      </p>

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
                      className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-surface text-sm font-semibold text-ink shadow-card hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
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
            Application values{" "}
            <span className="font-normal text-ink-muted">(optional CSV: filename, brand, alcohol, class)</span>
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Application values CSV"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setClaimed(parseClaimedCsv(await f.text()));
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
                  "filename,brand,alcohol,class\nacme-front.jpg,Acme Distillery,40% Alc./Vol. (80 Proof),Vodka\n",
                )
              }
            >
              Download CSV template
            </button>
            {claimed.size > 0 && (
              <span className="text-sm text-ink-muted">
                {claimed.size} application row(s) loaded — products that match get an Approve/Review/Reject verdict.
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
      </div>

      {rows.length > 0 && (
        <div className="mt-5 max-h-[32rem] overflow-auto rounded-card border border-border">
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
              {rows.map((r, i) => (
                <tr key={`${r.product}-${i}`} className="border-b border-border align-top odd:bg-surface-muted hover:bg-brand-50">
                  <td className="px-3 py-2.5 text-ink">
                    <span className="font-mono text-xs">{r.product}</span>
                    <span className="block text-xs text-ink-muted">
                      {r.imageCount} image{r.imageCount === 1 ? "" : "s"}
                    </span>
                    {r.note && <span className="mt-0.5 block text-ink-muted">{r.note}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink">
                    {r.completeness ? CLASS_LABEL[r.completeness.beverageClass] : r.status === "pending" ? "…" : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-ink">{cell(r, (e) => e.brand)}</td>
                  <td className="px-3 py-2.5 text-ink">{cell(r, (e) => e.classType)}</td>
                  <td className="px-3 py-2.5 text-ink">{cell(r, (e) => e.alcoholContentText)}</td>
                  <td className="px-3 py-2.5">
                    {r.completeness ? (
                      <StatusBadge tone={COMPLETENESS_TONE[r.completeness.overall]} label={r.completeness.overall} />
                    ) : (
                      <span className="text-ink-muted">{r.status === "pending" ? "…" : "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.result ? (
                      <StatusBadge tone={toneForStatus(r.result.overall)} label={r.result.overall} />
                    ) : (
                      <span className="text-ink-muted">{claimed.size > 0 ? "no application row" : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ImageLightbox
        open={zoom !== null}
        src={zoom?.src ?? ""}
        alt={zoom?.alt ?? ""}
        onClose={() => setZoom(null)}
      />
    </section>
  );
}
