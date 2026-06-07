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

function badgeClass(value: string): string {
  switch (value) {
    case "pass":
    case "approve":
      return "bg-green-700 text-white";
    case "review":
    case "re-upload":
      return "bg-amber-700 text-white";
    case "fail":
    case "reject":
      return "bg-red-700 text-white";
    default:
      return "bg-slate-500 text-white";
  }
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
  const inputClass =
    "min-h-[44px] w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2 text-slate-900 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">Batch verify</h2>
      <p className="mt-1 text-slate-700">
        Upload many label images plus a CSV mapping each image <code>filename</code> to its claimed
        values (<code>filename, brand, alcoholContent, classType, netContents</code>).
      </p>

      <div className="mt-4 flex flex-col gap-5">
        <div>
          <label htmlFor={ids.images} className="mb-1 block font-medium text-slate-800">
            Label images (select multiple)
          </label>
          <input
            id={ids.images}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setImages(Array.from(e.target.files ?? []))}
            className={inputClass}
          />
          {images.length > 0 && (
            <p className="mt-1 text-sm text-slate-600">{images.length} image(s) selected.</p>
          )}
        </div>

        <div>
          <label htmlFor={ids.csv} className="mb-1 block font-medium text-slate-800">
            Claimed-values CSV
          </label>
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
          {csvName && <p className="mt-1 text-sm text-slate-600">Loaded: {csvName}</p>}
        </div>

        {error && (
          <p
            id={ids.err}
            role="alert"
            className="rounded-lg border-2 border-red-700 bg-red-50 px-3 py-2 font-medium text-red-800"
          >
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void process()}
            disabled={running}
            className="min-h-[48px] rounded-lg bg-blue-700 px-6 text-lg font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {running ? "Processing…" : "Verify batch"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={completedRows === 0}
            className="min-h-[48px] rounded-lg border-2 border-blue-700 px-6 text-lg font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Export results to CSV
          </button>
        </div>

        {rows.length > 0 && (
          <p aria-live="polite" className="text-sm font-medium text-slate-700">
            Processed {done} / {rows.length}
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Batch verification results</caption>
            <thead>
              <tr className="border-b-2 border-slate-300 text-slate-700">
                <th scope="col" className="py-2 pr-3 font-semibold">Filename</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Brand</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Alcohol</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Warning</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Overall</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.filename}-${i}`} className="border-b border-slate-200 align-top">
                  <td className="py-2 pr-3 font-mono text-xs text-slate-900">
                    {r.filename}
                    {r.note && <span className="block text-slate-500">{r.note}</span>}
                  </td>
                  {[r.brand, r.alcohol, r.warning, r.overall].map((v, j) => (
                    <td key={j} className="py-2 pr-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                          ["…", "—"].includes(v) ? "text-slate-500" : badgeClass(v)
                        }`}
                      >
                        {v}
                      </span>
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
