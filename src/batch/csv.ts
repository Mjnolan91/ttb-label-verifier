/**
 * batch/csv.ts — pure CSV helpers for the batch screen. Parsing the claimed-values CSV
 * (filename -> claimed) and serializing results to CSV. No DOM, fully unit-testable.
 */
import type { ExtractedFields } from "@/domain";
import type { VerifyResult, CompletenessResult } from "@/compare";
import { FIELD_CATALOG } from "@/extraction/fieldCatalog";

/** Claimed values for one label, keyed by its image filename. */
export interface ClaimedRow {
  filename: string;
  brand?: string;
  alcoholContent?: string;
  classType?: string;
  netContents?: string;
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

/**
 * Serialize one CSV cell with two layers of safety:
 *  - CSV-injection defang (CWE-1236): a cell beginning with `=`, `+`, `-`, `@`, tab, or CR is a
 *    spreadsheet formula trigger. Extracted values originate from importer-supplied label images and
 *    a non-technical agent opens this export in Excel/LibreOffice, so we prefix such a cell with a
 *    single quote to force it to be treated as text (never evaluated as a formula).
 *  - RFC-4180 quoting: wrap and double internal quotes when the value contains a comma, quote, or
 *    newline. Applied AFTER defanging so the protective leading quote is preserved.
 */
function csvCell(v: string): string {
  const defanged = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(defanged) ? `"${defanged.replace(/"/g, '""')}"` : defanged;
}

/** One analysis row: the extracted fields for an image, plus an optional verification verdict. */
export interface AnalysisRow {
  filename: string;
  extracted: ExtractedFields;
  result?: VerifyResult | null;
  completeness?: CompletenessResult;
  /** The headline verdict after gating on completeness; falls back to result.overall. */
  overall?: VerifyResult["overall"] | null;
}

const fmtConf = (n: number | undefined): string => (typeof n === "number" ? n.toFixed(2) : "");
const fmtBool = (b: boolean | null | undefined): string =>
  b === true ? "yes" : b === false ? "no" : "";

/**
 * Serialize extracted label data to CSV (the extraction-first export). The per-field columns are
 * DERIVED from FIELD_CATALOG — one `<col>` value + one `<col>_conf` per field — so the CSV covers
 * exactly the field set the JSON export dumps (no silently-dropped wine/spirits fields). The two
 * warning format flags and the completeness summary follow; verdict columns (brand_status,
 * alcohol_status, warning_status, overall) are appended ONLY when at least one row carries a
 * verification result, leaving them blank for rows without one.
 */
export function analysisToCsv(rows: AnalysisRow[]): string {
  const hasVerdict = rows.some((r) => r.result);
  const fieldCols = FIELD_CATALOG.flatMap((d) => [d.csvColumn, `${d.csvColumn}_conf`]);
  const base = ["filename", ...fieldCols, "warning_all_caps", "warning_bold", "completeness"];
  const verdictCols = ["brand_status", "alcohol_status", "warning_status", "overall"];
  const header = hasVerdict ? [...base, ...verdictCols] : base;

  const body = rows.map((r) => {
    const e = r.extracted;
    const eByKey = e as unknown as Record<string, string | undefined>;
    const cells: string[] = [r.filename];
    for (const d of FIELD_CATALOG) {
      cells.push(eByKey[d.key] ?? "", fmtConf(e.confidence[d.confKey]));
    }
    cells.push(
      fmtBool(e.warningPrefixIsAllCaps),
      fmtBool(e.warningPrefixIsBold),
      r.completeness ? r.completeness.overall : "",
    );
    if (hasVerdict) {
      const v = r.result;
      cells.push(
        v ? v.brand.status : "",
        v ? v.alcohol.status : "",
        v ? v.warning.status : "",
        r.overall ?? (v ? v.overall : ""),
      );
    }
    return cells.map(csvCell).join(",");
  });
  return [header.join(","), ...body].join("\n");
}
