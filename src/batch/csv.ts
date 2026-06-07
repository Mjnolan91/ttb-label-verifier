/**
 * batch/csv.ts — pure CSV helpers for the batch screen (US-013). Parsing the claimed-values CSV
 * (filename -> claimed) and serializing the results table to CSV. No DOM, fully unit-testable.
 */

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
