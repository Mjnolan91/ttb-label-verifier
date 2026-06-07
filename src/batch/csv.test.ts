/**
 * csv.test.ts (US-013) — CSV parse/serialize helpers for batch mode.
 */
import { describe, it, expect } from "vitest";
import { parseCsv, parseClaimedCsv, resultsToCsv } from "./csv";

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
