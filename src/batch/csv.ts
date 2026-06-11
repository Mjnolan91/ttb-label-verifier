/**
 * batch/csv.ts — pure CSV helpers for the batch screen. Parsing the claimed-values CSV
 * (filename -> claimed) and serializing results to CSV. No DOM, fully unit-testable.
 */
import type { ExtractedFields } from "@/domain";
import type { VerifyResult, VerifyFieldKey, CompletenessResult } from "@/compare";
import { FIELD_CATALOG } from "@/extraction/fieldCatalog";

/** The per-field verdict columns, in display order. A stable union of every comparable field so the
 *  header is consistent across a heterogeneous batch (rows compare different subsets); a field a row
 *  didn't compare is left blank. `overall` is appended after these. */
const VERDICT_FIELDS: readonly { key: VerifyFieldKey; col: string }[] = [
  { key: "brand", col: "brand_status" },
  { key: "classType", col: "class_type_status" },
  { key: "alcohol", col: "alcohol_status" },
  { key: "netContents", col: "net_contents_status" },
  { key: "name", col: "name_status" },
  { key: "address", col: "address_status" },
  { key: "countryOfOrigin", col: "country_of_origin_status" },
  { key: "fancifulName", col: "fanciful_name_status" },
  { key: "statementOfComposition", col: "statement_of_composition_status" },
  { key: "warning", col: "warning_status" },
];

/** Claimed values for one label, keyed by its image filename. */
export interface ClaimedRow {
  filename: string;
  brand?: string;
  alcoholContent?: string;
  classType?: string;
  netContents?: string;
  name?: string;
  address?: string;
  countryOfOrigin?: string;
  fancifulName?: string;
  statementOfComposition?: string;
}

/**
 * Tokenize CSV text into records of fields in ONE quote-aware pass (RFC 4180): a comma or newline
 * inside a double-quoted cell is cell content, not a separator — so Excel multi-line cells and this
 * module's own exports (csvCell quotes embedded newlines) both parse. Newlines inside quotes are
 * normalized to "\n"; "" inside quotes is an escaped quote.
 */
function tokenize(text: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  const endField = () => {
    fields.push(cur);
    cur = "";
  };
  const endRecord = () => {
    endField();
    records.push(fields);
    fields = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (ch === "\r" && text[i + 1] === "\n") {
        cur += "\n";
        i++;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
    } else {
      cur += ch;
    }
  }
  if (cur !== "" || fields.length > 0) endRecord();
  return records;
}

/** Parse CSV text into an array of header-keyed row objects (blank records skipped). */
export function parseCsv(text: string): Record<string, string>[] {
  const records = tokenize(text).filter((cells) => cells.some((c) => c.trim().length > 0));
  if (records.length === 0) return [];
  const headers = records[0].map((h) => h.trim());
  return records.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

/**
 * Build a filename -> ClaimedRow map from a claimed-values CSV. Rows without a filename are skipped.
 * Headers match case-insensitively (Excel users retitle them), and the results-export column names
 * (net_contents, country_of_origin, fanciful_name, statement_of_composition) are accepted as aliases
 * so an edited export re-imports as application values. For class/type the printed DESIGNATION wins:
 * `classType`/`type` before the broad derived `class` category the export also carries.
 */
export function parseClaimedCsv(text: string): Map<string, ClaimedRow> {
  const map = new Map<string, ClaimedRow>();
  for (const r of parseCsv(text)) {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) lower[k.toLowerCase()] = v;
    const g = (...keys: string[]): string | undefined => {
      for (const k of keys) if (lower[k]) return lower[k];
      return undefined;
    };
    const filename = g("filename", "file") ?? "";
    if (!filename) continue;
    map.set(filename, {
      filename,
      brand: g("brand"),
      alcoholContent: g("alcoholcontent", "alcohol"),
      classType: g("classtype", "type", "class"),
      netContents: g("netcontents", "net", "net_contents"),
      name: g("name", "producer"),
      address: g("address", "addr"),
      countryOfOrigin: g("countryoforigin", "country", "origin", "country_of_origin"),
      fancifulName: g("fancifulname", "fanciful", "sellname", "fanciful_name"),
      statementOfComposition: g("statementofcomposition", "composition", "soc", "statement_of_composition"),
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

/** One analysis row: the extracted fields for an image, plus an optional verification verdict and the
 *  reviewer's recorded worklist decision. */
export interface AnalysisRow {
  filename: string;
  extracted: ExtractedFields;
  result?: VerifyResult | null;
  completeness?: CompletenessResult;
  /** The headline verdict after gating on completeness; falls back to result.overall. */
  overall?: VerifyResult["overall"] | null;
  /** The reviewer's recorded decision (worklist), distinct from the AI/effective verdict. */
  decision?: "approve" | "reject";
  /** A free-text note captured with the decision. */
  note?: string;
  /** Human description of a PARTIAL read (an image of the product dropped out): the audit record
   *  must say the extraction covers only the surviving images. Blank for clean reads. */
  readFailures?: string;
}

/** Human-readable forms for the recorded decision, for the export. */
const DECISION_LABEL: Record<"approve" | "reject", string> = {
  approve: "approved",
  reject: "returned for revision",
};

const fmtConf = (n: number | undefined): string => (typeof n === "number" ? n.toFixed(2) : "");
const fmtBool = (b: boolean | null | undefined): string =>
  b === true ? "yes" : b === false ? "no" : "";

/** Name each element a label is failing on, so a reviewer triaging a big batch can see WHICH TTB
 *  element is wrong from the export alone (not just an aggregate "incomplete"). A mandatory element
 *  that's missing, or any element that's present-but-malformed, is a defect; conditional-absent is not. */
function fmtCompletenessIssues(c: CompletenessResult | undefined): string {
  if (!c) return "";
  return c.elements
    .filter((el) => el.status === "malformed" || (el.status === "missing" && el.necessity === "mandatory"))
    .map((el) => `${el.label} (${el.status === "malformed" ? "wrong format" : "missing"})`)
    .join("; ");
}

/**
 * Serialize extracted label data to CSV (the extraction-first export). The per-field columns are
 * DERIVED from FIELD_CATALOG — one `<col>` value + one `<col>_conf` per field — so the CSV covers
 * exactly the field set the JSON export dumps (no silently-dropped wine/spirits fields). The two
 * warning format flags and the completeness summary follow; the per-field verdict columns (one
 * `<field>_status` per comparable field + `overall`) are appended ONLY when at least one row carries a
 * verification result, left blank for fields a row didn't compare (and for rows without a verdict).
 */
export function analysisToCsv(rows: AnalysisRow[]): string {
  // Emit the verdict columns when a row carries EITHER a per-field result (batch) or just a gated
  // headline `overall` (the single screen passes the field list + the gated overall).
  const hasVerdict = rows.some((r) => r.result || r.overall);
  // The worklist decision columns appear only once any row has been decided (so a plain extraction
  // export stays unchanged).
  const hasDecision = rows.some((r) => r.decision || r.note);
  // The partial-read column appears only when some row actually had an image drop out.
  const hasReadFailures = rows.some((r) => r.readFailures);
  const fieldCols = FIELD_CATALOG.flatMap((d) => [d.csvColumn, `${d.csvColumn}_conf`]);
  const base = ["filename", ...fieldCols, "warning_all_caps", "warning_bold", "completeness", "completeness_issues"];
  const verdictCols = [...VERDICT_FIELDS.map((f) => f.col), "overall"];
  const decisionCols = ["decision", "reviewer_note"];
  const header = [
    ...base,
    ...(hasVerdict ? verdictCols : []),
    ...(hasDecision ? decisionCols : []),
    ...(hasReadFailures ? ["read_failures"] : []),
  ];

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
      fmtCompletenessIssues(r.completeness),
    );
    if (hasVerdict) {
      const statusByKey = new Map((r.result?.fields ?? []).map((f) => [f.key, f.status]));
      for (const f of VERDICT_FIELDS) cells.push(statusByKey.get(f.key) ?? "");
      cells.push(r.overall ?? r.result?.overall ?? "");
    }
    if (hasDecision) {
      cells.push(r.decision ? DECISION_LABEL[r.decision] : "", r.note ?? "");
    }
    if (hasReadFailures) {
      cells.push(r.readFailures ?? "");
    }
    return cells.map(csvCell).join(",");
  });
  return [header.join(","), ...body].join("\n");
}
