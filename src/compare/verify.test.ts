/**
 * verify.test.ts — the orchestration (verifyLabel) and the overall-verdict reduction.
 */
import { describe, it, expect } from "vitest";
import { verifyLabel, overallVerdict } from "./verify";
import { CANONICAL_GOVERNMENT_WARNING } from "@/domain";
import type { ClaimedFields, ExtractedFields } from "@/domain";

const claimedClean: ClaimedFields = {
  brand: "OLD TOM DISTILLERY",
  classType: "distilled-spirits",
  alcoholContentText: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
};

function extractedClean(): ExtractedFields {
  return {
    brand: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: { brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96, warningText: 0.97 },
  };
}

describe("overallVerdict reduction", () => {
  it("approve when all pass", () => {
    expect(overallVerdict(["pass", "pass", "pass"])).toBe("approve");
  });
  it("review when any review and no fail", () => {
    expect(overallVerdict(["pass", "review", "pass"])).toBe("review");
  });
  it("reject when any fail (even alongside review)", () => {
    expect(overallVerdict(["pass", "fail", "review"])).toBe("reject");
  });
});

describe("verifyLabel", () => {
  it("approves a fully compliant label", () => {
    const r = verifyLabel(claimedClean, extractedClean());
    expect(r.brand.status).toBe("pass");
    expect(r.alcohol.status).toBe("pass");
    expect(r.warning.status).toBe("pass");
    expect(r.overall).toBe("approve");
  });

  it("rejects when ABV is out of the spirits tolerance", () => {
    const ex = extractedClean();
    ex.alcoholContentText = "46% Alc./Vol. (92 Proof)";
    const r = verifyLabel(claimedClean, ex);
    expect(r.alcohol.status).toBe("fail");
    expect(r.overall).toBe("reject");
  });

  it("rejects when the warning prefix is title-case (flag-driven)", () => {
    const ex = extractedClean();
    ex.warningPrefixIsAllCaps = false;
    const r = verifyLabel(claimedClean, ex);
    expect(r.warning.status).toBe("fail");
    expect(r.overall).toBe("reject");
  });

  it("routes a near-miss brand typo to review (overall review)", () => {
    const ex = extractedClean();
    ex.brand = "Old Tomm Distillery";
    const claimed = { ...claimedClean, brand: "Old Tom Distillery" };
    const r = verifyLabel(claimed, ex);
    expect(r.brand.status).toBe("review");
    expect(r.overall).toBe("review");
  });

  it("does NOT exempt the warning when only the CLAIMED ABV is sub-0.5% but the label's ABV is not", () => {
    // A mis-stated/understated application ABV must not wave away a genuinely-missing statutory warning.
    const ex: ExtractedFields = {
      brand: "Cellar Door",
      classType: "Red Wine",
      alcoholContentText: "12% Alc./Vol.", // label is clearly NOT sub-0.5%
      warningText: "", // no warning on the label
      warningPrefixIsAllCaps: false,
      warningPrefixIsBold: null,
      confidence: { brand: 0.95, alcoholContent: 0.95 },
    };
    const r = verifyLabel(
      { brand: "Cellar Door", classType: "Red Wine", alcoholContentText: "0.3% Alc./Vol." },
      ex,
    );
    expect(r.warning.status).not.toBe("pass"); // missing warning is not exempted by the claimed value
  });

  it("exempts the warning only when BOTH claimed and label ABV prove sub-0.5%", () => {
    const ex: ExtractedFields = {
      brand: "Near Beer",
      classType: "Non-Alcoholic Malt Beverage",
      alcoholContentText: "0.3% Alc./Vol.",
      warningText: "",
      warningPrefixIsAllCaps: false,
      warningPrefixIsBold: null,
      confidence: { brand: 0.95, alcoholContent: 0.95 },
    };
    const r = verifyLabel(
      { brand: "Near Beer", classType: "Non-Alcoholic Malt Beverage", alcoholContentText: "0.3% Alc./Vol." },
      ex,
    );
    expect(r.warning.status).toBe("pass"); // exempt: both ABVs prove sub-0.5%
  });

  it("routes a LOW-CONFIDENCE field to review via the asymmetric gate (overall review)", () => {
    const ex = extractedClean();
    ex.confidence = { ...ex.confidence, alcoholContent: 0.4 }; // below the 0.7 field threshold
    const r = verifyLabel(claimedClean, ex);
    expect(r.alcohol.status).toBe("review");
    expect(r.brand.status).toBe("pass"); // high-confidence fields still pass
    expect(r.overall).toBe("review");
  });

  it("preserves the underlying value verdict + confidence when a MATCH is gated on a fuzzy read", () => {
    // The MALT & HOP BREWERY case: the values match, the read is just below the trust threshold.
    const ex = extractedClean();
    ex.confidence = { ...ex.confidence, brand: 0.67 };
    const r = verifyLabel(claimedClean, ex);
    expect(r.brand.status).toBe("review"); // gated verdict — a human still glances (compliance unchanged)
    expect(r.brand.valueStatus).toBe("pass"); // …but the UI can see the values actually matched
    expect(r.brand.gatedByConfidence).toBe(true);
    expect(r.brand.readConfidence).toBeCloseTo(0.67);
    // A confidently-read field exposes its confidence too, but is NOT flagged as confidence-gated.
    expect(r.alcohol.gatedByConfidence).toBe(false);
    expect(r.alcohol.readConfidence).toBeCloseTo(0.98);
  });
});

describe("verifyLabel — full field-by-field application match", () => {
  it("emits an ordered fields list of the compared elements", () => {
    const r = verifyLabel(claimedClean, extractedClean());
    expect(r.fields.map((f) => f.key)).toEqual(["brand", "classType", "alcohol", "netContents", "warning"]);
    expect(r.fields.every((f) => typeof f.label === "string" && f.label.length > 0)).toBe(true);
    // the named accessors are the same verdicts as the list entries (back-compat)
    expect(r.brand.status).toBe(r.fields.find((f) => f.key === "brand")!.status);
  });

  it("compares a field ONLY when the application provides it (blank class/type + net -> no card)", () => {
    const claimed: ClaimedFields = { brand: "OLD TOM DISTILLERY", alcoholContentText: "45% Alc./Vol. (90 Proof)" };
    const keys = verifyLabel(claimed, extractedClean()).fields.map((f) => f.key);
    expect(keys).toEqual(["brand", "alcohol", "warning"]);
  });

  it("a broad application class matches the label's specific designation — no false reject", () => {
    // claimed "distilled-spirits" vs label "Kentucky Straight Bourbon Whiskey" -> pass
    const r = verifyLabel(claimedClean, extractedClean());
    expect(r.fields.find((f) => f.key === "classType")!.status).toBe("pass");
    expect(r.overall).toBe("approve");
  });

  it("a mismatched net contents worsens the headline (reject)", () => {
    const ex = extractedClean();
    ex.netContents = "375 mL";
    const r = verifyLabel(claimedClean, ex);
    expect(r.fields.find((f) => f.key === "netContents")!.status).toBe("fail");
    expect(r.overall).toBe("reject");
  });

  it("compares producer name / address / origin when the application supplies them", () => {
    const ex = extractedClean();
    ex.name = "ABC Distillery";
    ex.address = "Frederick, MD";
    ex.countryOfOrigin = "USA";
    ex.confidence = { ...ex.confidence, name: 0.95, address: 0.95, countryOfOrigin: 0.95 };
    const claimed: ClaimedFields = { ...claimedClean, name: "ABC Distillery", address: "Frederick, MD", countryOfOrigin: "USA" };
    const r = verifyLabel(claimed, ex);
    expect(r.fields.map((f) => f.key)).toEqual([
      "brand", "classType", "alcohol", "netContents", "name", "address", "countryOfOrigin", "warning",
    ]);
    expect(r.fields.find((f) => f.key === "name")!.status).toBe("pass");
    expect(r.overall).toBe("approve");
  });
});
