"use client";

/**
 * BatchVerify — extraction-first batch screen. Upload many label images and the AI reads them all
 * into a results table, exportable as JSON or CSV. A claimed-values CSV is OPTIONAL: supply one and
 * each image is additionally verified against its row (a per-image verdict column appears).
 *
 * Scales without freezing the UI: images run through a small concurrency pool and the table updates
 * per-result (React state), so a 50-image batch streams in rather than blocking.
 */
import { useId, useState } from "react";
import { parseClaimedCsv, analysisToCsv, type ClaimedRow } from "@/batch/csv";
import type { ExtractedFields } from "@/domain";
import type { VerifyResult } from "@/compare";
import type { VerifyApiResponse, VerifyApiError } from "../api/verify/contract";
import { downscaleForUpload } from "../imageDownscale";
import { FormField } from "../ui/FormField";
import { ErrorAlert } from "../ui/ErrorAlert";
import { StatusBadge } from "../ui/StatusBadge";
import { toneForStatus } from "../ui/status";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "../ui/fieldStyles";
import { downloadJson, downloadCsv } from "../ui/download";

const CONCURRENCY = 4;

type RowStatus = "pending" | "done" | "error";
interface BatchRow {
  filename: string;
  status: RowStatus;
  extracted?: ExtractedFields;
  result?: VerifyResult | null;
  note?: string;
}

async function analyzeOne(file: File, claimed: ClaimedRow | undefined): Promise<BatchRow> {
  try {
    const uploadFile = await downscaleForUpload(file);
    const form = new FormData();
    form.set("image", uploadFile);
    // Claimed values are OPTIONAL — present only if the CSV had a matching row, which requests a verdict.
    if (claimed?.brand) form.set("brand", claimed.brand);
    if (claimed?.alcoholContent) form.set("alcoholContent", claimed.alcoholContent);
    if (claimed?.classType) form.set("classType", claimed.classType);
    if (claimed?.netContents) form.set("netContents", claimed.netContents);

    const res = await fetch("/api/verify", { method: "POST", body: form });
    const json: VerifyApiResponse | VerifyApiError = await res.json();
    if (!res.ok) return { filename: file.name, status: "error", note: (json as VerifyApiError).error };
    const r = json as VerifyApiResponse;
    return {
      filename: file.name,
      status: "done",
      extracted: r.extracted,
      result: r.result,
      note: r.readable ? undefined : r.message,
    };
  } catch {
    return { filename: file.name, status: "error", note: "Request failed." };
  }
}

/** A table cell value pulled from the extraction (or a placeholder for pending/error/missing). */
function cell(row: BatchRow, pick: (e: ExtractedFields) => string | undefined): string {
  if (row.status === "pending") return "…";
  if (!row.extracted) return "—";
  const v = pick(row.extracted);
  return v && v.trim() !== "" ? v : "—";
}

export function BatchVerify() {
  const ids = { images: useId(), csv: useId(), err: useId() };
  const [images, setImages] = useState<File[]>([]);
  const [csvText, setCsvText] = useState<string>("");
  const [csvName, setCsvName] = useState<string>("");
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function process() {
    setError(null);
    if (images.length === 0) {
      setError("Add one or more label images.");
      return;
    }
    // CSV is optional: with one, we also verify each image against its matching row.
    const claimedMap = csvText ? parseClaimedCsv(csvText) : new Map<string, ClaimedRow>();

    const files = images;
    setRows(files.map((f) => ({ filename: f.name, status: "pending" as RowStatus })));
    setRunning(true);
    setDone(0);

    let next = 0;
    let completed = 0;
    const worker = async () => {
      while (next < files.length) {
        const idx = next++;
        const row = await analyzeOne(files[idx], claimedMap.get(files[idx].name));
        setRows((prev) => {
          const copy = prev.slice();
          copy[idx] = row;
          return copy;
        });
        completed++;
        setDone(completed);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
    setRunning(false);
  }

  const completed = rows.filter((r) => r.status === "done" && r.extracted);
  const hasVerdict = rows.some((r) => r.result);

  function exportJson() {
    downloadJson(
      "ttb-extractions.json",
      completed.map((r) => ({
        filename: r.filename,
        extracted: r.extracted,
        ...(r.result ? { result: r.result } : {}),
      })),
    );
  }
  function exportCsv() {
    downloadCsv(
      "ttb-extractions.csv",
      analysisToCsv(completed.map((r) => ({ filename: r.filename, extracted: r.extracted!, result: r.result }))),
    );
  }

  return (
    <section className="rounded-card border border-border border-t-4 border-t-brand-600 bg-surface p-6 shadow-card sm:p-8">
      <h2 className="text-xl font-semibold text-ink">Batch read</h2>
      <p className="mt-1 text-ink-muted">
        Upload many label images and the AI reads them all into the table below — export as JSON or
        CSV. Optionally add an application-values CSV (<code>filename, brand, alcoholContent,
        classType, netContents</code>) to also verify each label.
      </p>

      <div className="mt-5 flex flex-col gap-5">
        <FormField label="Label images (select multiple)" htmlFor={ids.images} required>
          <input
            id={ids.images}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setImages(Array.from(e.target.files ?? []))}
            className={inputClass}
          />
          {images.length > 0 && (
            <p className="mt-1.5 text-sm text-ink-muted">{images.length} image(s) selected.</p>
          )}
        </FormField>

        <FormField
          label="Application-values CSV"
          htmlFor={ids.csv}
          hint="Optional — add one only if you also want a compliance verdict per label."
        >
          <input
            id={ids.csv}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setCsvName(f.name);
                void f.text().then(setCsvText);
              }
            }}
            className={inputClass}
          />
          {csvName && <p className="mt-1.5 text-sm text-ink-muted">Loaded: {csvName}</p>}
        </FormField>

        {error && <ErrorAlert id={ids.err}>{error}</ErrorAlert>}

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void process()} disabled={running} className={`${primaryButtonClass} text-lg`}>
            {running ? "Reading…" : "Read all labels"}
          </button>
          <button type="button" onClick={exportJson} disabled={completed.length === 0} className={secondaryButtonClass}>
            Download JSON
          </button>
          <button type="button" onClick={exportCsv} disabled={completed.length === 0} className={secondaryButtonClass}>
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
                {["Filename", "Brand", "Class / type", "Alcohol", "Net", "Warning", ...(hasVerdict ? ["Verdict"] : [])].map(
                  (h) => (
                    <th
                      key={h}
                      scope="col"
                      className="sticky top-0 z-10 border-b-2 border-border bg-surface px-3 py-2.5 font-semibold"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.filename}-${i}`} className="border-b border-border align-top odd:bg-surface-muted hover:bg-brand-50">
                  <td className="px-3 py-2.5 font-mono text-xs text-ink">
                    {r.filename}
                    {r.note && <span className="mt-0.5 block font-sans text-ink-muted">{r.note}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink">{cell(r, (e) => e.brand)}</td>
                  <td className="px-3 py-2.5 text-ink">{cell(r, (e) => e.classType)}</td>
                  <td className="px-3 py-2.5 text-ink">{cell(r, (e) => e.alcoholContentText)}</td>
                  <td className="px-3 py-2.5 text-ink">{cell(r, (e) => e.netContents)}</td>
                  <td className="px-3 py-2.5 text-ink">
                    {r.status === "pending" ? "…" : r.extracted ? (r.extracted.warningText ? "yes" : "no") : "—"}
                  </td>
                  {hasVerdict && (
                    <td className="px-3 py-2.5">
                      {r.result ? (
                        <StatusBadge tone={toneForStatus(r.result.overall)} label={r.result.overall} />
                      ) : (
                        <span className="text-ink-muted">{r.status === "pending" ? "…" : "—"}</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
