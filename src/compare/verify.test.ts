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
});
