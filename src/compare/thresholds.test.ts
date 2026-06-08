/**
 * thresholds.test.ts — the readability floor that drives the re-upload path.
 */
import { describe, it, expect } from "vitest";
import {
  isExtractionReadable,
  MIN_READABLE_CONFIDENCE,
  applyConfidenceGate,
  FIELD_REVIEW_CONFIDENCE,
} from "./thresholds";
import type { ExtractedFields } from "@/domain";
import type { FieldResult } from "./types";

function ex(confidence: ExtractedFields["confidence"]): ExtractedFields {
  return { warningPrefixIsAllCaps: false, warningPrefixIsBold: null, confidence };
}

describe("isExtractionReadable", () => {
  it("exposes the readability floor as 0.5", () => {
    expect(MIN_READABLE_CONFIDENCE).toBe(0.5);
  });

  it("is readable when at least one field is confidently read", () => {
    expect(isExtractionReadable(ex({ brand: 0.98, warningText: 0.2 }))).toBe(true);
  });

  it("is UNREADABLE when every field is below the floor (blurry/glare photo)", () => {
    expect(
      isExtractionReadable(
        ex({ brand: 0.31, classType: 0.28, alcoholContent: 0.26, netContents: 0.3, warningText: 0.29 }),
      ),
    ).toBe(false);
  });

  it("is UNREADABLE when nothing was read at all (unknown filename, all zero)", () => {
    expect(isExtractionReadable(ex({ brand: 0, alcoholContent: 0, warningText: 0 }))).toBe(false);
  });
});

describe("applyConfidenceGate (asymmetric per-field threshold)", () => {
  const pass: FieldResult = { status: "pass", claimed: "x", extracted: "x", reason: "ok" };
  const fail: FieldResult = { status: "fail", claimed: "x", extracted: "y", reason: "bad" };
  const review: FieldResult = { status: "review", claimed: "x", extracted: "x'", reason: "close" };

  it("exposes the field-review threshold as 0.7", () => {
    expect(FIELD_REVIEW_CONFIDENCE).toBe(0.7);
  });

  it("keeps a pass AT or ABOVE the threshold", () => {
    expect(applyConfidenceGate(pass, 0.7).status).toBe("pass");
    expect(applyConfidenceGate(pass, 0.95).status).toBe("pass");
  });

  it("downgrades a pass JUST BELOW the threshold to review (boundary)", () => {
    expect(applyConfidenceGate(pass, 0.69).status).toBe("review");
  });

  it("downgrades a low-confidence fail to review (don't hard-reject an uncertain read)", () => {
    expect(applyConfidenceGate(fail, 0.3).status).toBe("review");
  });

  it("keeps a confident fail", () => {
    expect(applyConfidenceGate(fail, 0.95).status).toBe("fail");
  });

  it("leaves an existing review as review at any confidence", () => {
    expect(applyConfidenceGate(review, 0.99).status).toBe("review");
    expect(applyConfidenceGate(review, 0.05).status).toBe("review");
  });

  it("treats missing confidence as 0 (review) and preserves the underlying reason", () => {
    const gated = applyConfidenceGate(pass, undefined);
    expect(gated.status).toBe("review");
    expect(gated.reason).toContain("ok");
  });
});
