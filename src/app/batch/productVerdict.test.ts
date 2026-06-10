/**
 * productVerdict.test.ts — the shared CSV-row + drawer-edits derivation behind the batch worklist.
 */
import { describe, expect, it } from "vitest";
import { applicationFromCsv, deriveProductVerdict, mergeApplication } from "./productVerdict";
import type { ClaimedRow } from "@/batch/csv";
import { CANONICAL_GOVERNMENT_WARNING, type ExtractedFields } from "@/domain";

const CSV_ROW: ClaimedRow = {
  filename: "acme-front.png",
  brand: "Acme",
  alcoholContent: "40% Alc./Vol.",
  classType: "Vodka",
};

const EXTRACTED: ExtractedFields = {
  brand: "Acme",
  classType: "Vodka",
  alcoholContentText: "40% Alc./Vol.",
  netContents: "750 mL",
  name: "Acme Distillery",
  address: "Peoria, IL",
  warningText: CANONICAL_GOVERNMENT_WARNING,
  warningPrefixIsAllCaps: true,
  warningPrefixIsBold: true,
  confidence: {
    brand: 0.98,
    classType: 0.97,
    alcoholContent: 0.98,
    netContents: 0.96,
    name: 0.95,
    address: 0.95,
    warningText: 0.97,
  },
};

describe("mergeApplication — CSV row overlaid with drawer edits", () => {
  it("returns the CSV row's values when there are no edits", () => {
    expect(mergeApplication(CSV_ROW)).toMatchObject({ brand: "Acme", alcoholContent: "40% Alc./Vol." });
  });

  it("an edit overrides the CSV value; an explicit empty string CLEARS it", () => {
    const merged = mergeApplication(CSV_ROW, { brand: "Acme Reserve", classType: "" });
    expect(merged?.brand).toBe("Acme Reserve");
    expect(merged?.classType).toBe("");
    expect(merged?.alcoholContent).toBe("40% Alc./Vol."); // untouched CSV value survives
  });

  it("edits alone (no CSV row) form an application — the no-CSV drawer path", () => {
    expect(mergeApplication(null, { brand: "Acme" })?.brand).toBe("Acme");
  });

  it("returns null when every value is blank (no application supplied)", () => {
    expect(mergeApplication(null)).toBeNull();
    expect(mergeApplication(null, { brand: "  " })).toBeNull();
    expect(mergeApplication({ filename: "x.png" }, {})).toBeNull();
  });

  it("applicationFromCsv maps the CSV's alcoholContent onto the alcohol input key", () => {
    expect(applicationFromCsv(CSV_ROW).alcoholContent).toBe("40% Alc./Vol.");
  });
});

describe("deriveProductVerdict — the one gate + verdict derivation", () => {
  it("no application -> completeness-only combined verdict (overall null), still reviewable", () => {
    const pv = deriveProductVerdict(null, EXTRACTED, true);
    expect(pv.combined?.verify).toBeNull();
    expect(pv.combined?.overall).toBeNull();
    expect(pv.combined?.completeness).toBeTruthy();
    expect(pv.application).toBeNull();
  });

  it("a complete application -> a comparison verdict", () => {
    const pv = deriveProductVerdict(mergeApplication(CSV_ROW), EXTRACTED, true);
    expect(pv.combined?.verify).toBeTruthy();
    expect(pv.combined?.overall).toBe("approve");
    expect(pv.claimedNeeds).toBeUndefined();
  });

  it("a partial application (brand only, spirits) names the missing gate value", () => {
    const pv = deriveProductVerdict(mergeApplication(null, { brand: "Acme" }), EXTRACTED, true);
    expect(pv.combined?.verify).toBeNull();
    expect(pv.claimedNeeds).toMatch(/alcohol content/i);
  });

  it("an unreadable label derives no combined verdict at all", () => {
    const pv = deriveProductVerdict(mergeApplication(CSV_ROW), EXTRACTED, false);
    expect(pv.combined).toBeNull();
  });

  it("clearing the CSV brand via an edit drops the row back to 'add a brand'", () => {
    const pv = deriveProductVerdict(mergeApplication(CSV_ROW, { brand: "" }), EXTRACTED, true);
    expect(pv.combined?.verify).toBeNull();
    expect(pv.claimedNeeds).toMatch(/brand/i);
  });
});
