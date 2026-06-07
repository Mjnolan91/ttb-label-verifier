/**
 * MockVisionProvider.test.ts (US-003) — proves the mock is hermetic (filename-keyed, no image
 * bytes, no network), faithfully replays fixtures, and produces a DETERMINISTIC below-threshold
 * result (no fabricated values, no verdict) for unknown/unreadable filenames.
 */
import { describe, it, expect } from "vitest";
import { MockVisionProvider, getVisionProvider } from "./index";

const mock = new MockVisionProvider();

describe("MockVisionProvider — known fixtures (filename-keyed)", () => {
  it("replays the clean-pass fixture for a known filename", async () => {
    const r = await mock.extract({ filename: "old-tom-bourbon-clean.svg" });
    expect(r.brand).toBe("OLD TOM DISTILLERY");
    expect(r.alcoholContentText).toBe("45% Alc./Vol. (90 Proof)");
    expect(r.netContents).toBe("750 mL");
    expect(r.warningText?.startsWith("GOVERNMENT WARNING:")).toBe(true);
    expect(r.warningPrefixIsAllCaps).toBe(true);
    expect(r.warningPrefixIsBold).toBe(true);
    expect(r.confidence.brand).toBeCloseTo(0.98, 5);
    expect(r.confidence.warningText ?? 0).toBeGreaterThan(0.9);
  });

  it("replays the real-image fixture with proof ABSENT (proof is optional)", async () => {
    const r = await mock.extract({ filename: "abc-single-barrel-clean.jpg" });
    expect(r.brand).toBe("ABC");
    expect(r.alcoholContentText).toBe("45% Alc./Vol."); // no "(N Proof)" printed
    expect(r.warningPrefixIsAllCaps).toBe(true);
    expect(r.warningPrefixIsBold).toBe(true);
  });

  it("does not read image bytes — only the filename matters", async () => {
    const withBytes = await mock.extract({
      filename: "old-tom-bourbon-clean.svg",
      data: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/png",
    });
    const withoutBytes = await mock.extract({ filename: "old-tom-bourbon-clean.svg" });
    expect(withBytes).toEqual(withoutBytes);
  });
});

describe("MockVisionProvider — low-confidence / unreadable paths", () => {
  it("replays the KNOWN unreadable fixture below thresholds, prefix bold undetectable (null)", async () => {
    const r = await mock.extract({ filename: "unreadable-blurry.svg" });
    // Every reported field confidence is low (~0.3) — far below any approve/review threshold.
    const confidences = Object.values(r.confidence).filter(
      (c): c is number => typeof c === "number",
    );
    expect(confidences.length).toBeGreaterThan(0);
    for (const c of confidences) expect(c).toBeLessThan(0.5);
    expect(r.warningPrefixIsBold).toBeNull(); // undetectable, not a violation
  });

  it("distinguishes confidently-MISSING warning from an unreadable image", async () => {
    const missing = await mock.extract({ filename: "warning-missing.svg" });
    expect(missing.warningText).toBe(""); // absent...
    expect(missing.confidence.warningText ?? 0).toBeGreaterThan(0.9); // ...but HIGH confidence -> US-004 fails it

    const unreadable = await mock.extract({ filename: "unreadable-blurry.svg" });
    expect(unreadable.confidence.warningText ?? 1).toBeLessThan(0.5); // LOW confidence -> review/re-upload
  });

  it("returns a DETERMINISTIC, no-value, zero-confidence result for an UNKNOWN filename", async () => {
    const r1 = await mock.extract({ filename: "totally-unknown-file.jpg" });
    const r2 = await mock.extract({ filename: "totally-unknown-file.jpg" });
    expect(r1).toEqual(r2); // deterministic from the filename alone

    // Never fabricates a field value.
    expect(r1.brand).toBeUndefined();
    expect(r1.classType).toBeUndefined();
    expect(r1.alcoholContentText).toBeUndefined();
    expect(r1.netContents).toBeUndefined();
    expect(r1.warningText).toBeUndefined();

    // Never synthesizes a verdict: all confidences are 0 (below any threshold).
    expect(r1.confidence.brand).toBe(0);
    expect(r1.confidence.alcoholContent).toBe(0);
    expect(r1.confidence.warningText).toBe(0);
    expect(r1.warningPrefixIsAllCaps).toBe(false);
    expect(r1.warningPrefixIsBold).toBeNull();
  });
});

describe("getVisionProvider — env selection (mock by default, offline)", () => {
  it("defaults to the mock provider when VISION_PROVIDER is unset", () => {
    const prev = process.env.VISION_PROVIDER;
    delete process.env.VISION_PROVIDER;
    try {
      const p = getVisionProvider();
      expect(p).toBeInstanceOf(MockVisionProvider);
      expect(p.name).toBe("mock");
    } finally {
      if (prev !== undefined) process.env.VISION_PROVIDER = prev;
    }
  });

  it("selects mock explicitly (case-insensitive)", () => {
    expect(getVisionProvider("mock").name).toBe("mock");
    expect(getVisionProvider("MOCK").name).toBe("mock");
  });

  it("errors cleanly for the ocr provider not yet wired in", () => {
    // llm IS wired (US-009); its config/selection is covered in LlmVisionProvider.test.ts.
    expect(() => getVisionProvider("ocr")).toThrow(/ocr/i);
  });

  it("rejects an unknown provider name", () => {
    expect(() => getVisionProvider("banana")).toThrow(/mock\|llm\|ocr/i);
  });
});
