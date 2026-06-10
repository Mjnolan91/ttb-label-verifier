/**
 * MockVisionProvider.test.ts — proves the mock is hermetic (filename-keyed, no image
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
    expect(r.brand).toBe("ABC Distillery"); // TTB producer-is-the-brand: the "ABC" masthead is its acronym
    expect(r.name).toBe("ABC Distillery");
    expect(r.alcoholContentText).toBe("45% Alc./Vol."); // no "(N Proof)" printed
    expect(r.warningPrefixIsAllCaps).toBe(true);
    expect(r.warningPrefixIsBold).toBe(true);
  });

  it("tolerates a browser download-rename like 'demo-old-tom-clean (1).png'", async () => {
    // The README/in-app sample links serve fixture files; a second download (or an existing copy in
    // Downloads) gets browser-renamed with a " (n)" suffix. The mock must still recognize it, or the
    // app rejects the exact file it just offered the user.
    const renamed = await mock.extract({ filename: "demo-old-tom-clean (1).png" });
    const original = await mock.extract({ filename: "demo-old-tom-clean.png" });
    expect(renamed).toEqual(original);
    expect(renamed.brand).toBe("OLD TOM DISTILLERY");
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
    expect(missing.confidence.warningText ?? 0).toBeGreaterThan(0.9); // ...but HIGH confidence -> the comparator fails it

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

  // llm and ocr are both wired; their config/selection live in their own
  // test files (LlmVisionProvider.test.ts, OcrVisionProvider.test.ts).

  it("rejects an unknown provider name", () => {
    expect(() => getVisionProvider("banana")).toThrow(/mock\|llm\|ocr/i);
  });

  it("NEVER echoes a secret-shaped VISION_PROVIDER value (a pasted API key must not leak)", () => {
    // Regression: this error surfaces verbatim in the public /api/verify error body, and a real key
    // pasted into VISION_PROVIDER on the deployment dashboard was once echoed back to any caller.
    const pastedKey = "sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
    let message = "";
    try {
      getVisionProvider(pastedKey);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain(pastedKey);
    expect(message).not.toContain("abc123"); // no fragment of the value either
    expect(message).toMatch(/looks like an api key/i);
    expect(message).toMatch(/rotate/i);
  });

  it("summarizes (does not echo) a long non-name value, but still names a short safe typo", () => {
    let long = "";
    try {
      getVisionProvider("x".repeat(40));
    } catch (e) {
      long = (e as Error).message;
    }
    expect(long).not.toContain("xxxxx");
    expect(() => getVisionProvider("gemni")).toThrow(/'gemni'/); // short typo: safe and helpful to repeat
  });
});
