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
import { analysisToCsv } from "@/batch/csv";
import type { VerifyApiResponse, VerifyApiError } from "../api/verify/contract";
import { downscaleForUpload } from "../imageDownscale";
import { ErrorAlert } from "../ui/ErrorAlert";
import { StatusBadge } from "../ui/StatusBadge";
import { type Tone } from "../ui/status";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "../ui/fieldStyles";
import { downloadJson, downloadCsv } from "../ui/download";

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

async function analyzeProduct(group: ProductImages): Promise<BatchRow> {
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
    return {
      ...base,
      status: "done",
      extracted: r.extracted,
      completeness: r.completeness,
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
  const ids = { images: useId() };
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupFiles(files), [files]);

  async function process() {
    setError(null);
    if (files.length === 0) {
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
        const row = await analyzeProduct(groups[idx]);
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
        })),
      ),
    );
  }

  const COLS = ["Product", "Type", "Brand", "Class / type", "Alcohol", "Completeness"];

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
          <label htmlFor={ids.images} className="mb-1.5 block font-medium text-ink">
            Label images <span className="font-normal text-ink-muted">(select multiple)</span>
          </label>
          <input
            id={ids.images}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className={inputClass}
          />
          {files.length > 0 && (
            <p className="mt-1.5 text-sm text-ink-muted">
              {files.length} image(s) → <strong className="text-ink">{groups.length} product(s)</strong>{" "}
              {groups.some((g) => g.images.length > 1) ? "(some paired front/back)" : ""}
            </p>
          )}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
