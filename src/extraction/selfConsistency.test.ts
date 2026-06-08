import { describe, it, expect } from "vitest";
import { aggregateSamples } from "./selfConsistency";
import type { ExtractedFields } from "@/domain";

function read(brand: string, conf: number, allCaps = true): ExtractedFields {
  return {
    brand, classType: "Bourbon", alcoholContentText: "45% Alc./Vol.", netContents: "750 mL",
    warningText: "GOVERNMENT WARNING: ...", warningPrefixIsAllCaps: allCaps, warningPrefixIsBold: true,
    confidence: { brand: conf, classType: 0.9, alcoholContent: 0.9, netContents: 0.9, warningText: 0.9 },
  };
}

describe("aggregateSamples", () => {
  it("a single sample is returned unchanged (preserves the provider's own confidence)", () => {
    const only = read("Old Tom", 0.42);
    const out = aggregateSamples([only]);
    expect(out.brand).toBe("Old Tom");
    expect(out.confidence.brand).toBe(0.42); // untouched — critical for the deterministic mock
  });

  it("full agreement -> majority value at confidence 1.0", () => {
    const out = aggregateSamples([read("Old Tom", 0.6), read("Old Tom", 0.6), read("Old Tom", 0.6)]);
    expect(out.brand).toBe("Old Tom");
    expect(out.confidence.brand).toBe(1);
  });

  it("2 of 3 agree -> majority value at 0.67 (below the 0.7 review gate)", () => {
    const out = aggregateSamples([read("Old Tom", 0.9), read("Old Tom", 0.9), read("0ld T0m", 0.9)]);
    expect(out.brand).toBe("Old Tom");
    expect(out.confidence.brand).toBeCloseTo(0.667, 2);
  });

  it("votes the warning flags too (majority all-caps wins)", () => {
    const out = aggregateSamples([read("X", 0.9, true), read("X", 0.9, true), read("X", 0.9, false)]);
    expect(out.warningPrefixIsAllCaps).toBe(true);
  });
});
