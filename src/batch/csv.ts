/**
 * batch/csv.ts — pure CSV helpers for the batch screen (US-013). Parsing the claimed-values CSV
 * (filename -> claimed) and serializing results to CSV. No DOM, fully unit-testable.
 */
import type { ExtractedFields } from "@/domain";
import type { VerifyResult } from "@/compare";

/** Claimed values for one label, keyed by its image filename. */
export interface ClaimedRow {
  filename: string;
  brand?: string;
  alcoholContent?: string;
  classType?: string;
  netContents?: string;
}

/** One row of the results table, as exported to CSV. */
export interface CsvResultRow {
  filename: string;
  brand: string;
  alcohol: string;
  warning: string;
  overall: string;
}

/** Parse a single CSV line into fields, honoring double-quoted fields (with escaped "" quotes). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/** Parse CSV text into an array of header-keyed row objects (blank lines skipped). */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

/** Build a filename -> ClaimedRow map from a claimed-values CSV. Rows without a filename are skipped. */
export function parseClaimedCsv(text: string): Map<string, ClaimedRow> {
  const map = new Map<string, ClaimedRow>();
  for (const r of parseCsv(text)) {
    const filename = r.filename || r.Filename || r.FILENAME || r.file || "";
    if (!filename) continue;
    map.set(filename, {
      filename,
      brand: r.brand || undefined,
      alcoholContent: r.alcoholContent || r.alcohol || undefined,
      classType: r.classType || r.class || r.type || undefined,
      netContents: r.netContents || r.net || undefined,
    });
  }
  return map;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Serialize results to CSV with a header row (filename, brand, alcohol, warning, overall). */
export function resultsToCsv(rows: CsvResultRow[]): string {
  const header = ["filename", "brand", "alcohol", "warning", "overall"];
  const body = rows.map((r) =>
    [r.filename, r.brand, r.alcohol, r.warning, r.overall].map(csvCell).join(","),
  );
  return [header.join(","), ...body].join("\n");
}

/** One analysis row: the extracted fields for an image, plus an optional verification verdict. */
export interface AnalysisRow {
  filename: string;
  extracted: ExtractedFields;
  result?: VerifyResult | null;
}

const fmtConf = (n: number | undefined): string => (typeof n === "number" ? n.toFixed(2) : "");
const fmtBool = (b: boolean | null | undefined): string =>
  b === true ? "yes" : b === false ? "no" : "";

/**
 * Serialize extracted label data to CSV (the extraction-first export). Verdict columns
 * (brand_status, alcohol_status, warning_status, overall) are appended ONLY when at least one row
 * carries a verification result; rows without a result leave them blank.
 */
export function analysisToCsv(rows: AnalysisRow[]): string {
  const hasVerdict = rows.some((r) => r.result);
  const base = [
    "filename",
    "brand",
    "class_type",
    "alcohol",
    "net_contents",
    "warning_present",
    "warning_all_caps",
    "warning_bold",
    "brand_conf",
    "alcohol_conf",
    "warning_conf",
  ];
  const verdictCols = ["brand_status", "alcohol_status", "warning_status", "overall"];
  const header = hasVerdict ? [...base, ...verdictCols] : base;

  const body = rows.map((r) => {
    const e = r.extracted;
    const cells = [
      r.filename,
      e.brand ?? "",
      e.classType ?? "",
      e.alcoholContentText ?? "",
      e.netContents ?? "",
      e.warningText ? "yes" : "no",
      fmtBool(e.warningPrefixIsAllCaps),
      fmtBool(e.warningPrefixIsBold),
      fmtConf(e.confidence.brand),
      fmtConf(e.confidence.alcoholContent),
      fmtConf(e.confidence.warningText),
    ];
    if (hasVerdict) {
      const v = r.result;
      cells.push(
        v ? v.brand.status : "",
        v ? v.alcohol.status : "",
        v ? v.warning.status : "",
        v ? v.overall : "",
      );
    }
    return cells.map(csvCell).join(",");
  });
  return [header.join(","), ...body].join("\n");
}
