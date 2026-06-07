"use client";

/**
 * BatchVerify (US-013, stretch) — upload many label images + a CSV (filename -> claimed values),
 * verify them all, show a progressive results table, and export the results to CSV.
 *
 * Scales without freezing the UI: images are processed through a small concurrency pool and the
 * table updates per-result (React state), so a 50-row batch streams in rather than blocking.
 */
import { useId, useState } from "react";
import { parseClaimedCsv, resultsToCsv, type ClaimedRow } from "@/batch/csv";
import type { VerifyApiResponse, VerifyApiError } from "../api/verify/contract";
import { FormField } from "../ui/FormField";
import { ErrorAlert } from "../ui/ErrorAlert";
import { StatusBadge } from "../ui/StatusBadge";
import { toneForStatus } from "../ui/status";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "../ui/fieldStyles";

const CONCURRENCY = 4;

type RowStatus = "pending" | "done" | "error";
interface BatchRow {
  filename: string;
  brand: string;
  alcohol: string;
  warning: string;
  overall: string;
  status: RowStatus;
  note?: string;
}

async function verifyOne(file: File, claimed: ClaimedRow | undefined): Promise<BatchRow> {
  const base: BatchRow = {
    filename: file.name,
    brand: "—",
    alcohol: "—",
    warning: "—",
    overall: "—",
    status: "error",
  };
  if (!claimed) return { ...base, note: "No CSV row matches this filename." };

  const form = new FormData();
  form.set("image", file);
  form.set("brand", claimed.brand ?? "");
  form.set("alcoholContent", claimed.alcoholContent ?? "");
  form.set("classType", claimed.classType ?? "");
  form.set("netContents", claimed.netContents ?? "");

  try {
    const res = await fetch("/api/verify", { method: "POST", body: form });
    const json: VerifyApiResponse | VerifyApiError = await res.json();
    if (!res.ok) return { ...base, note: (json as VerifyApiError).error };
    const r = json as VerifyApiResponse;
    if (!r.readable || !r.result) {
      return { ...base, status: "done", overall: "re-upload", note: r.message };
    }
    return {
      filename: file.name,
      brand: r.result.brand.status,
      alcohol: r.result.alcohol.status,
      warning: r.result.warning.status,
      overall: r.result.overall,
      status: "done",
    };
  } catch {
    return { ...base, note: "Request failed." };
  }
}

/** A result-table cell: a StatusBadge for real verdicts, plain muted text for pending/placeholder. */
function Cell({ value }: { value: string }) {
  if (value === "…" || value === "—") {
    return <span className="text-ink-muted">{value}</span>;
  }
  return <StatusBadge tone={toneForStatus(value)} label={value} />;
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
    if (!csvText) {
      setError("Add a CSV that maps each image filename to its claimed values.");
      return;
    }
    const claimedMap = parseClaimedCsv(csvText);
    if (claimedMap.size === 0) {
      setError("The CSV needs a 'filename' column and at least one row.");
      return;
    }

    const files = images;
    setRows(
      files.map((f) => ({
        filename: f.name,
        brand: "…",
        alcohol: "…",
        warning: "…",
        overall: "…",
        status: "pending" as RowStatus,
      })),
    );
    setRunning(true);
    setDone(0);

    let next = 0;
    let completed = 0;
    const worker = async () => {
      while (next < files.length) {
        const idx = next++;
        const row = await verifyOne(files[idx], claimedMap.get(files[idx].name));
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

  function exportCsv() {
    const completed = rows.filter((r) => r.status === "done");
    const csv = resultsToCsv(
      completed.map(({ filename, brand, alcohol, warning, overall }) => ({
        filename,
        brand,
        alcohol,
        warning,
        overall,
      })),
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ttb-batch-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const completedRows = rows.filter((r) => r.status === "done").length;

  return (
    <section className="rounded-card border border-border border-t-4 border-t-brand-600 bg-surface p-6 shadow-card sm:p-8">
      <h2 className="text-xl font-semibold text-ink">Batch verify</h2>
      <p className="mt-1 text-ink-muted">
        Upload many label images plus a CSV mapping each image <code>filename</code> to its claimed
        values (<code>filename, brand, alcoholContent, classType, netContents</code>).
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

        <FormField label="Claimed-values CSV" htmlFor={ids.csv} required>
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
            {running ? "Processing…" : "Verify batch"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={completedRows === 0}
            className={`${secondaryButtonClass} text-lg`}
          >
            Export results to CSV
          </button>
        </div>

        {rows.length > 0 && (
          <p aria-live="polite" className="text-sm font-medium text-ink-muted">
            Processed {done} / {rows.length}
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-5 max-h-[32rem] overflow-auto rounded-card border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Batch verification results</caption>
            <thead>
              <tr className="text-ink-muted">
                {["Filename", "Brand", "Alcohol", "Warning", "Overall"].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="sticky top-0 z-10 border-b-2 border-border bg-surface px-3 py-2.5 font-semibold"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.filename}-${i}`}
                  className="border-b border-border align-top odd:bg-surface-muted hover:bg-brand-50"
                >
                  <td className="px-3 py-2.5 font-mono text-xs text-ink">
                    {r.filename}
                    {r.note && <span className="mt-0.5 block font-sans text-ink-muted">{r.note}</span>}
                  </td>
                  {[r.brand, r.alcohol, r.warning, r.overall].map((v, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <Cell value={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
