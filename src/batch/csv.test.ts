/**
 * csv.test.ts (US-013) — CSV parse/serialize helpers for batch mode.
 */
import { describe, it, expect } from "vitest";
import { parseCsv, parseClaimedCsv, resultsToCsv, analysisToCsv } from "./csv";
import type { ExtractedFields } from "@/domain";
import type { VerifyResult } from "@/compare";

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

describe("resultsToCsv", () => {
  it("emits a header and quotes fields with commas", () => {
    const csv = resultsToCsv([
      { filename: "x.jpg", brand: "pass", alcohol: "fail", warning: "pass", overall: "reject" },
      { filename: "weird,name.jpg", brand: "review", alcohol: "pass", warning: "pass", overall: "review" },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("filename,brand,alcohol,warning,overall");
    expect(lines[1]).toBe("x.jpg,pass,fail,pass,reject");
    expect(lines[2]).toContain('"weird,name.jpg"');
  });
});

describe("analysisToCsv (extraction-first export)", () => {
  it("emits extraction columns (no verdict columns) when no row has a result", () => {
    const csv = analysisToCsv([{ filename: "x.png", extracted: EXTRACTED }]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "filename,brand,class_type,alcohol,net_contents,warning_present,warning_all_caps,warning_bold,brand_conf,alcohol_conf,warning_conf,completeness",
    );
    expect(lines[1]).toBe(
      "x.png,OLD TOM DISTILLERY,Kentucky Straight Bourbon Whiskey,45% Alc./Vol. (90 Proof),750 mL,yes,yes,yes,0.98,0.97,0.96,",
    );
  });

  it("appends verdict columns when any row has a result; blank for rows without", () => {
    const result: VerifyResult = {
      brand: { status: "pass", claimed: "OLD TOM DISTILLERY", extracted: "OLD TOM DISTILLERY", reason: "match" },
      alcohol: { status: "pass", claimed: "45%", extracted: "45%", reason: "within tolerance" },
      warning: { status: "fail", claimed: "", extracted: "", reason: "prefix not all caps" },
      overall: "reject",
    };
    const csv = analysisToCsv([
      { filename: "a.png", extracted: EXTRACTED, result },
      { filename: "b.png", extracted: EXTRACTED },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("brand_status,alcohol_status,warning_status,overall");
    expect(lines[1].split(",").slice(-4)).toEqual(["pass", "pass", "fail", "reject"]);
    expect(lines[2].split(",").slice(-4)).toEqual(["", "", "", ""]); // no result -> blank verdict
  });

  it("blanks missing values, renders null bold as empty, and quotes commas", () => {
    const sparse: ExtractedFields = {
      warningPrefixIsAllCaps: false,
      warningPrefixIsBold: null,
      confidence: {},
    };
    const line = analysisToCsv([{ filename: "weird,name.png", extracted: sparse }]).split("\n")[1];
    expect(line).toBe('"weird,name.png",,,,,no,no,,,,,');
  });
});
