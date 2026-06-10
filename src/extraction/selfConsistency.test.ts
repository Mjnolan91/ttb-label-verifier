import { describe, it, expect } from "vitest";
import { aggregateSamples, selfConsistentExtract } from "./selfConsistency";
import type { ExtractedFields } from "@/domain";
import type { VisionProvider } from "./VisionProvider";
import { MIN_READABLE_CONFIDENCE, FIELD_REVIEW_CONFIDENCE } from "@/compare";

function read(brand: string, conf: number, allCaps = true): ExtractedFields {
  return {
    brand, classType: "Bourbon", alcoholContentText: "45% Alc./Vol.", netContents: "750 mL",
    warningText: "GOVERNMENT WARNING: ...", warningPrefixIsAllCaps: allCaps, warningPrefixIsBold: true,
    confidence: { brand: conf, classType: 0.9, alcoholContent: 0.9, netContents: 0.9, warningText: 0.9 },
  };
}

/** A read with overridable fields (incl. absence via "" / undefined) for the presence/value cases. */
function readWith(overrides: Partial<ExtractedFields>): ExtractedFields {
  return { ...read("Old Tom", 0.9), ...overrides };
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

  it("a tri-state warning-flag TIE asserts nothing — a 1/1/1 split must not adopt the first sample", () => {
    // true/false/null split one apiece: there is no majority, and which sample sits first is an
    // accident of array order. Adopting it would let a one-of-three "false" hard-fail the caps/bold
    // check; a tie must fall to null (cannot assert -> surfaced for a human, never auto-failed).
    const out = aggregateSamples([
      readWith({ warningPrefixIsAllCaps: false, warningPrefixIsBold: false }),
      readWith({ warningPrefixIsAllCaps: true, warningPrefixIsBold: true }),
      readWith({ warningPrefixIsAllCaps: null, warningPrefixIsBold: null }),
    ]);
    expect(out.warningPrefixIsAllCaps).toBeNull();
    expect(out.warningPrefixIsBold).toBeNull();
  });

  it("a two-sample warning-flag tie (true vs false) also falls to null", () => {
    const out = aggregateSamples([
      readWith({ warningPrefixIsBold: true }),
      readWith({ warningPrefixIsBold: false }),
    ]);
    expect(out.warningPrefixIsBold).toBeNull();
  });

  // ---- Presence vs value agreement ------------------------------------------------------------

  it("STABLE presence (all samples carry the field) is unchanged -> full agreement", () => {
    const out = aggregateSamples([
      readWith({ countryOfOrigin: "Product of Scotland", confidence: { ...read("X", 0.9).confidence, countryOfOrigin: 0.9 } }),
      readWith({ countryOfOrigin: "Product of Scotland", confidence: { ...read("X", 0.9).confidence, countryOfOrigin: 0.9 } }),
      readWith({ countryOfOrigin: "Product of Scotland", confidence: { ...read("X", 0.9).confidence, countryOfOrigin: 0.9 } }),
    ]);
    expect(out.countryOfOrigin).toBe("Product of Scotland");
    expect(out.confidence.countryOfOrigin).toBe(1);
  });

  it("STABLE absence (no sample carries the field) is unchanged -> absent at full agreement", () => {
    // countryOfOrigin is absent in every sample (the helper never sets it).
    const out = aggregateSamples([read("Old Tom", 0.9), read("Old Tom", 0.9), read("Old Tom", 0.9)]);
    expect(out.countryOfOrigin).toBeUndefined();
    expect(out.confidence.countryOfOrigin).toBe(1);
  });

  it("UNSTABLE presence (2 absent, 1 valued) is NOT asserted as a confident absence", () => {
    // A field the majority dropped but one sample read: the old vote would surface "" at 0.67 and
    // read it as a confident clean absence. Presence-aware voting routes it to review instead.
    const out = aggregateSamples([
      readWith({ countryOfOrigin: "" }),
      readWith({ countryOfOrigin: "" }),
      readWith({ countryOfOrigin: "Product of Scotland", confidence: { ...read("X", 0.9).confidence, countryOfOrigin: 0.9 } }),
    ]);
    // It surfaces the value a human can confirm (not a fabricated absence) but at a review-band confidence.
    expect(out.countryOfOrigin).toBe("Product of Scotland");
    expect(out.confidence.countryOfOrigin).toBeLessThan(MIN_READABLE_CONFIDENCE);
    expect(out.confidence.countryOfOrigin).toBeLessThan(FIELD_REVIEW_CONFIDENCE);
  });

  it("UNSTABLE presence (1 absent, 2 agreeing values) still routes the field to review", () => {
    const out = aggregateSamples([
      readWith({ countryOfOrigin: "Product of Scotland", confidence: { ...read("X", 0.9).confidence, countryOfOrigin: 0.9 } }),
      readWith({ countryOfOrigin: "Product of Scotland", confidence: { ...read("X", 0.9).confidence, countryOfOrigin: 0.9 } }),
      readWith({ countryOfOrigin: undefined }),
    ]);
    expect(out.countryOfOrigin).toBe("Product of Scotland"); // majority among present samples
    expect(out.confidence.countryOfOrigin).toBeLessThan(FIELD_REVIEW_CONFIDENCE);
  });

  // ---- Alcohol numeric cross-check ------------------------------------------------------------

  it("ABV-digit disagreement (45% vs 48%) routes alcohol to review even at a text majority", () => {
    const out = aggregateSamples([
      readWith({ alcoholContentText: "45% Alc./Vol." }),
      readWith({ alcoholContentText: "45% Alc./Vol." }),
      readWith({ alcoholContentText: "48% Alc./Vol." }),
    ]);
    // Text vote would otherwise land 2/3 = 0.67; a wrong-magnitude split must be capped below it.
    expect(out.confidence.alcoholContent).toBeLessThan(FIELD_REVIEW_CONFIDENCE);
    expect(out.confidence.alcoholContent).toBeLessThanOrEqual(0.3);
  });

  it("proof disagreement while ABV is stable also routes alcohol to review", () => {
    const out = aggregateSamples([
      readWith({ alcoholContentText: "45% Alc./Vol. (90 Proof)" }),
      readWith({ alcoholContentText: "45% Alc./Vol. (88 Proof)" }),
      readWith({ alcoholContentText: "45% Alc./Vol. (90 Proof)" }),
    ]);
    expect(out.confidence.alcoholContent).toBeLessThanOrEqual(0.3);
  });

  it("stable ABV with proof present on only some samples is NOT a disagreement", () => {
    // A missing proof on one sample is normal (labels omit it); only a CONFLICTING number is a split.
    const out = aggregateSamples([
      readWith({ alcoholContentText: "45% Alc./Vol. (90 Proof)" }),
      readWith({ alcoholContentText: "45% Alc./Vol." }),
      readWith({ alcoholContentText: "45% Alc./Vol. (90 Proof)" }),
    ]);
    // Raw text differs (proof present vs absent) so text agreement is 2/3, but the NUMBERS are stable,
    // so the alcohol guard does NOT cap it further.
    expect(out.confidence.alcoholContent).toBeCloseTo(0.667, 2);
  });

  it("fully-agreeing alcohol stays at full confidence (guard never down-weights agreement)", () => {
    const out = aggregateSamples([
      read("Old Tom", 0.9), read("Old Tom", 0.9), read("Old Tom", 0.9),
    ]);
    expect(out.confidence.alcoholContent).toBe(1);
  });
});

describe("selfConsistentExtract", () => {
  const img = { filename: "x", data: new Uint8Array([1]) };

  it("aggregates N successful samples to agreement-based confidence", async () => {
    const brands = ["Old Tom", "Old Tom", "0ld T0m"];
    let i = 0;
    const provider: VisionProvider = { name: "gemini", extract: async () => read(brands[i++], 0.9) };
    const out = await selfConsistentExtract([provider], img, undefined, 3);
    expect(out.brand).toBe("Old Tom");
    expect(out.confidence.brand).toBeCloseTo(0.667, 2);
  });

  it("tolerates a partial sample failure (aggregates the survivors)", async () => {
    let i = 0;
    const provider: VisionProvider = {
      name: "gemini",
      extract: async () => { i++; if (i === 2) throw new Error("transient 429"); return read("Old Tom", 0.9); },
    };
    const out = await selfConsistentExtract([provider], img, undefined, 3);
    expect(out.brand).toBe("Old Tom");
    // 2 survivors agreed -> 2/2 = 1.0 (the failed sample is not counted in the denominator)
    expect(out.confidence.brand).toBe(1);
  });

  it("rejects only when ALL samples fail", async () => {
    const provider: VisionProvider = { name: "gemini", extract: async () => { throw new Error("down"); } };
    await expect(selfConsistentExtract([provider], img, undefined, 3)).rejects.toThrow();
  });
});
