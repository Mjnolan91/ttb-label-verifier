/**
 * csv.test.ts — CSV parse/serialize helpers for batch mode.
 */
import { describe, it, expect } from "vitest";
import { parseCsv, parseClaimedCsv, analysisToCsv } from "./csv";
import type { ExtractedFields } from "@/domain";
import type { VerifyResult, VerifyField, CompletenessResult, OverallVerdict } from "@/compare";

/** Build a VerifyResult from an ordered field list; named accessors derived from it. */
function verifyResult(fields: VerifyField[], overall: OverallVerdict): VerifyResult {
  const byKey = (k: string) => fields.find((f) => f.key === k)!;
  return { fields, brand: byKey("brand"), alcohol: byKey("alcohol"), warning: byKey("warning"), overall };
}

const EXTRACTED: ExtractedFields = {
  brand: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContentText: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  warningText: "GOVERNMENT WARNING: ...",
  warningPrefixIsAllCaps: true,
  warningPrefixIsBold: true,
  confidence: { brand: 0.98, alcoholContent: 0.97, warningText: 0.96 },
};

describe("parseCsv", () => {
  it("parses headers and rows", () => {
    const rows = parseCsv("filename,brand\nlabel.jpg,Old Tom\n");
    expect(rows).toEqual([{ filename: "label.jpg", brand: "Old Tom" }]);
  });

  it("honors double-quoted fields containing commas and escaped quotes", () => {
    const rows = parseCsv('filename,alcoholContent\n"a,b.jpg","45% Alc./Vol. (90 ""Proof"")"');
    expect(rows[0].filename).toBe("a,b.jpg");
    expect(rows[0].alcoholContent).toBe('45% Alc./Vol. (90 "Proof")');
  });

  it("skips blank lines", () => {
    expect(parseCsv("filename\n\nlabel.jpg\n\n")).toHaveLength(1);
  });
});

describe("parseClaimedCsv", () => {
  it("maps filename -> claimed values", () => {
    const map = parseClaimedCsv(
      "filename,brand,alcoholContent,classType,netContents\n" +
        "old-tom.svg,OLD TOM DISTILLERY,45% Alc./Vol. (90 Proof),distilled-spirits,750 mL",
    );
    const row = map.get("old-tom.svg");
    expect(row?.brand).toBe("OLD TOM DISTILLERY");
    expect(row?.alcoholContent).toBe("45% Alc./Vol. (90 Proof)");
    expect(row?.classType).toBe("distilled-spirits");
    expect(row?.netContents).toBe("750 mL");
  });

  it("skips rows without a filename", () => {
    const map = parseClaimedCsv("filename,brand\n,No Name\nx.jpg,Has Name");
    expect(map.has("x.jpg")).toBe(true);
    expect(map.size).toBe(1);
  });
});

describe("analysisToCsv (extraction-first export)", () => {
  it("emits a value + _conf column for EVERY catalog field (CSV no longer drops wine/spirits fields)", () => {
    const csv = analysisToCsv([{ filename: "x.png", extracted: EXTRACTED }]);
    const header = csv.split("\n")[0].split(",");
    // The previously-dropped fields are now present, so CSV and JSON cover the same field set.
    for (const col of [
      "brand", "type", "alcohol", "net_contents", "warning_text", "class", "name", "address",
      "country_of_origin", "appellation", "vintage", "varietal", "sulfites", "age_statement",
      "commodity_statement", "completeness",
    ]) {
      expect(header).toContain(col);
    }
    for (const col of ["brand_conf", "alcohol_conf", "sulfites_conf"]) {
      expect(header).toContain(col);
    }
    expect(header).not.toContain("class_type");
    expect(header).not.toContain("brand_status"); // no verdict columns
  });

  it("populates values + confidence and leaves completeness blank when absent", () => {
    const csv = analysisToCsv([{ filename: "x.png", extracted: EXTRACTED }]);
    const lines = csv.split("\n");
    const header = lines[0].split(",");
    const row = lines[1].split(",");
    const get = (k: string) => row[header.indexOf(k)];
    expect(get("brand")).toBe("OLD TOM DISTILLERY");
    expect(get("type")).toBe("Kentucky Straight Bourbon Whiskey");
    expect(get("alcohol")).toBe("45% Alc./Vol. (90 Proof)");
    expect(get("warning_all_caps")).toBe("yes");
    expect(get("brand_conf")).toBe("0.98");
    expect(get("completeness")).toBe("");
  });

  it("appends per-field verdict columns when any row has a result; blank for fields not compared and rows without", () => {
    const result = verifyResult(
      [
        { key: "brand", label: "Brand name", status: "pass", claimed: "OLD TOM DISTILLERY", extracted: "OLD TOM DISTILLERY", reason: "match" },
        { key: "alcohol", label: "Alcohol content", status: "pass", claimed: "45%", extracted: "45%", reason: "within tolerance" },
        { key: "warning", label: "Government warning", status: "fail", claimed: "", extracted: "", reason: "prefix not all caps" },
      ],
      "reject",
    );
    const rows = parseCsv(analysisToCsv([
      { filename: "a.png", extracted: EXTRACTED, result },
      { filename: "b.png", extracted: EXTRACTED },
    ]));
    expect(rows[0].brand_status).toBe("pass");
    expect(rows[0].alcohol_status).toBe("pass");
    expect(rows[0].warning_status).toBe("fail");
    expect(rows[0].overall).toBe("reject");
    expect(rows[0].net_contents_status).toBe(""); // not compared by this result -> blank
    // a row with no verdict at all leaves every verdict column blank
    expect(rows[1].brand_status).toBe("");
    expect(rows[1].overall).toBe("");
  });

  it("emits the overall column for a confirm-screen row with a gated overall but no per-field result", () => {
    // The single confirm-to-approve screen exports only the gated `overall` (it has no 3-field
    // VerifyResult). The verdict columns must still appear, with the per-field cells left blank.
    const csv = analysisToCsv([{ filename: "x.png", extracted: EXTRACTED, overall: "approve" }]);
    const lines = csv.split("\n");
    const header = lines[0].split(",");
    expect(header).toContain("overall");
    const row = lines[1].split(",");
    expect(row[header.indexOf("overall")]).toBe("approve");
    expect(row[header.indexOf("brand_status")]).toBe(""); // confirm flow has no per-field VerifyResult
  });

  it("the overall column prefers the gated `overall` over result.overall when provided", () => {
    // The 3-check result alone would approve, but completeness gated it to review — exporting the
    // gated headline keeps the CSV consistent with the on-screen verdict.
    const result = verifyResult(
      [
        { key: "brand", label: "Brand name", status: "pass", claimed: "X", extracted: "X", reason: "" },
        { key: "alcohol", label: "Alcohol content", status: "pass", claimed: "40%", extracted: "40%", reason: "" },
        { key: "warning", label: "Government warning", status: "pass", claimed: "", extracted: "", reason: "" },
      ],
      "approve",
    );
    const csv = analysisToCsv([{ filename: "a.png", extracted: EXTRACTED, result, overall: "review" }]);
    const header = csv.split("\n")[0].split(",");
    const row = csv.split("\n")[1].split(",");
    expect(row[header.indexOf("overall")]).toBe("review"); // gated headline, not the comparison's "approve"
    expect(row[header.indexOf("brand_status")]).toBe("pass"); // per-field columns from the comparison
  });

  it("names each missing/malformed element in a completeness_issues column (triage from the export alone)", () => {
    const completeness: CompletenessResult = {
      beverageClass: "distilledSpirits",
      overall: "incomplete",
      elements: [
        { key: "brand", label: "Brand name", necessity: "mandatory", status: "present", detail: "ok" },
        { key: "netContents", label: "Net contents", necessity: "mandatory", status: "missing", detail: "not found" },
        { key: "governmentWarning", label: "Government warning", necessity: "mandatory", status: "malformed", detail: "prefix not bold" },
      ],
    };
    const parsed = parseCsv(analysisToCsv([{ filename: "x.png", extracted: EXTRACTED, completeness }]))[0];
    expect(parsed).toHaveProperty("completeness_issues");
    expect(parsed.completeness_issues).toBe("Net contents (missing); Government warning (wrong format)");
  });

  it("leaves completeness_issues blank for a complete label", () => {
    const completeness: CompletenessResult = {
      beverageClass: "distilledSpirits",
      overall: "complete",
      elements: [{ key: "brand", label: "Brand name", necessity: "mandatory", status: "present", detail: "ok" }],
    };
    const parsed = parseCsv(analysisToCsv([{ filename: "x.png", extracted: EXTRACTED, completeness }]))[0];
    expect(parsed.completeness_issues).toBe("");
  });

  it("keeps `overall` the last column, after completeness_issues and the per-field verdict columns", () => {
    const result = verifyResult(
      [
        { key: "brand", label: "Brand name", status: "pass", claimed: "X", extracted: "X", reason: "" },
        { key: "alcohol", label: "Alcohol content", status: "pass", claimed: "40%", extracted: "40%", reason: "" },
        { key: "warning", label: "Government warning", status: "pass", claimed: "", extracted: "", reason: "" },
      ],
      "approve",
    );
    const header = analysisToCsv([{ filename: "a.png", extracted: EXTRACTED, result, overall: "approve" }]).split("\n")[0].split(",");
    expect(header[header.length - 1]).toBe("overall");
    expect(header).toContain("net_contents_status"); // full per-field verdict set
    expect(header.indexOf("completeness_issues")).toBeLessThan(header.indexOf("brand_status"));
  });

  it("defangs spreadsheet formula triggers in cell values (CSV injection, CWE-1236)", () => {
    // Extracted values come from importer-supplied label images; a value that opens with =,+,-,@
    // must not execute as a formula when the agent opens the export in Excel/LibreOffice.
    const malicious: ExtractedFields = {
      brand: "=cmd|'/C calc'!A1",
      classType: "+1+1",
      netContents: "@SUM(A1:A9)",
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: true,
      confidence: {},
    };
    const row = parseCsv(analysisToCsv([{ filename: "-pwn.png", extracted: malicious }]))[0];
    expect(row.brand.startsWith("'=")).toBe(true);
    expect(row.type.startsWith("'+")).toBe(true);
    expect(row.net_contents.startsWith("'@")).toBe(true);
    expect(row.filename.startsWith("'-")).toBe(true);
  });

  it("blanks missing values, renders null bold as empty, and quotes commas", () => {
    const sparse: ExtractedFields = {
      warningPrefixIsAllCaps: false,
      warningPrefixIsBold: null,
      confidence: {},
    };
    const csv = analysisToCsv([{ filename: "sparse.png", extracted: sparse }]);
    const header = csv.split("\n")[0].split(",");
    const cells = csv.split("\n")[1].split(",");
    expect(cells[header.indexOf("warning_all_caps")]).toBe("no"); // false -> no
    expect(cells[header.indexOf("warning_bold")]).toBe(""); // null -> empty
    expect(cells[header.indexOf("brand")]).toBe(""); // nothing read -> blank
    // A comma in a filename is quoted (kept whole).
    const quoted = analysisToCsv([{ filename: "weird,name.png", extracted: sparse }]).split("\n")[1];
    expect(quoted.startsWith('"weird,name.png",')).toBe(true);
  });
});
