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
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: { brand: 0.98, alcoholContent: 0.98, warningText: 0.97 },
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
});
