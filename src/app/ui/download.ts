/**
 * download.ts — trigger a client-side file download from in-memory text (JSON / CSV exports).
 * Browser-only; call it from event handlers in client components.
 */
export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Pretty-print a value as JSON and download it. */
export function downloadJson(filename: string, data: unknown): void {
  downloadFile(filename, JSON.stringify(data, null, 2), "application/json");
}

/** Download CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  downloadFile(filename, csv, "text/csv");
}
