/**
 * thresholds.test.ts (US-008) — the readability floor that drives the re-upload path.
 */
import { describe, it, expect } from "vitest";
import { isExtractionReadable, MIN_READABLE_CONFIDENCE } from "./thresholds";
import type { ExtractedFields } from "@/domain";

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
