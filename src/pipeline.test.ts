/**
 * pipeline.test.ts — the PRIMARY orchestration path: read each of a product's images, MERGE them,
 * gate readability, and surface the all-images-timeout error. Exercised here directly with mock
 * providers (the eval harness only ever passes a single image, and the route test merges two copies
 * of the same fixture, so neither covers the genuine front/back merge or the failure branches).
 */
import { describe, it, expect } from "vitest";
import { runExtraction, runVerification } from "./pipeline";
import { CANONICAL_GOVERNMENT_WARNING, type ClaimedFields, type ExtractedFields } from "@/domain";
import type { ImageInput, VisionProvider } from "@/extraction";

function fields(partial: Partial<ExtractedFields>): ExtractedFields {
  return { warningPrefixIsAllCaps: false, warningPrefixIsBold: null, confidence: {}, ...partial };
}

/** A provider whose read depends on the image filename, so front/back can return different fields. */
function providerByFilename(byName: Record<string, () => Promise<ExtractedFields>>): VisionProvider {
  return {
    name: "mock",
    extract: (img: ImageInput) => {
      const impl = byName[img.filename];
      if (!impl) return Promise.reject(new Error(`no read for ${img.filename}`));
      return impl();
    },
  };
}

const img = (filename: string): ImageInput => ({ filename, data: new Uint8Array([1]) });
const timeout = (): Promise<ExtractedFields> => Promise.reject(new DOMException("timed out", "TimeoutError"));

describe("runExtraction — multi-image merge + readability gate", () => {
  it("merges fields from front and back into one record", async () => {
    const provider = providerByFilename({
      "front.jpg": () => Promise.resolve(fields({ brand: "ABC", confidence: { brand: 0.95 } })),
      "back.jpg": () =>
        Promise.resolve(
          fields({
            warningText: CANONICAL_GOVERNMENT_WARNING,
            warningPrefixIsAllCaps: true,
            warningPrefixIsBold: true,
            confidence: { warningText: 0.95 },
          }),
        ),
    });
    const { readable, extracted } = await runExtraction([provider], [img("front.jpg"), img("back.jpg")]);
    expect(readable).toBe(true);
    expect(extracted.brand).toBe("ABC"); // from the front
    expect(extracted.warningText).toContain("GOVERNMENT WARNING"); // from the back
    expect(extracted.warningPrefixIsAllCaps).toBe(true);
  });

  it("reconciles from the surviving image when another image's read fails", async () => {
    const provider = providerByFilename({
      "good.jpg": () => Promise.resolve(fields({ brand: "ABC", confidence: { brand: 0.95 } })),
      "slow.jpg": timeout,
    });
    const { readable, extracted } = await runExtraction([provider], [img("slow.jpg"), img("good.jpg")]);
    expect(readable).toBe(true);
    expect(extracted.brand).toBe("ABC");
  });

  it("throws a TimeoutError when EVERY image times out", async () => {
    const provider = providerByFilename({ "a.jpg": timeout, "b.jpg": timeout });
    await expect(runExtraction([provider], [img("a.jpg"), img("b.jpg")])).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("flags an all-low-confidence merged read as unreadable (re-upload path)", async () => {
    const provider = providerByFilename({
      "blurry.jpg": () => Promise.resolve(fields({ brand: "??", confidence: { brand: 0.2 } })),
    });
    const { readable } = await runExtraction([provider], [img("blurry.jpg")]);
    expect(readable).toBe(false);
  });
});

describe("runVerification", () => {
  const claimed: ClaimedFields = { brand: "ABC", alcoholContentText: "40% Alc./Vol." };

  it("returns result=null when the extraction is unreadable (never a fabricated verdict)", async () => {
    const provider = providerByFilename({
      "blurry.jpg": () => Promise.resolve(fields({ brand: "??", confidence: { brand: 0.2 } })),
    });
    const out = await runVerification([provider], claimed, [img("blurry.jpg")]);
    expect(out.readable).toBe(false);
    expect(out.result).toBeNull();
  });

  it("returns a verdict when readable and claimed values are supplied", async () => {
    const provider = providerByFilename({
      "front.jpg": () =>
        Promise.resolve(
          fields({
            brand: "ABC",
            alcoholContentText: "40% Alc./Vol.",
            warningText: CANONICAL_GOVERNMENT_WARNING,
            warningPrefixIsAllCaps: true,
            warningPrefixIsBold: true,
            confidence: { brand: 0.95, alcoholContent: 0.95, warningText: 0.95 },
          }),
        ),
    });
    const out = await runVerification([provider], claimed, [img("front.jpg")]);
    expect(out.readable).toBe(true);
    expect(out.result?.overall).toBe("approve");
  });
});

describe("runExtraction — self-consistency + bold-pass", () => {
  it("self-consistency over the deterministic mock is a no-op (fixture confidences intact)", async () => {
    // The mock provider (name='mock') forces samples=1, so aggregateSamples is never called and
    // the provider's own confidence values are preserved exactly.
    const provider = providerByFilename({
      "front.jpg": () =>
        Promise.resolve(
          fields({
            brand: "ABC",
            warningText: CANONICAL_GOVERNMENT_WARNING,
            warningPrefixIsAllCaps: true,
            warningPrefixIsBold: true,
            confidence: { brand: 0.88, warningText: 0.92 },
          }),
        ),
    });
    // provider.name is already "mock" (set by providerByFilename)
    const { readable, extracted } = await runExtraction([provider], [img("front.jpg")]);
    expect(readable).toBe(true);
    expect(extracted.brand).toBe("ABC");
    // Fixture confidence values must be preserved exactly (no aggregateSamples overwriting them).
    expect(extracted.confidence.brand).toBe(0.88);
    expect(extracted.confidence.warningText).toBe(0.92);
  });

  it("bold-pass overrides warningPrefixIsBold when provider has judgeWarningBold and warning is present", async () => {
    const extracted = fields({
      brand: "XYZ",
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: null,
      confidence: { brand: 0.95, warningText: 0.95 },
    });
    const boldProvider: VisionProvider = {
      name: "mock",
      extract: (_img: ImageInput) => Promise.resolve(extracted),
      judgeWarningBold: async (_img: ImageInput) => true,
    };
    const { extracted: out } = await runExtraction([boldProvider], [img("front.jpg")]);
    expect(out.warningPrefixIsBold).toBe(true);
  });

  it("bold verdict is NOT applied when no warning is present (pass runs speculatively in parallel, result discarded)", async () => {
    const noWarn = fields({ brand: "XYZ", warningPrefixIsBold: null, confidence: { brand: 0.95 } });
    const boldProvider: VisionProvider = {
      name: "mock",
      extract: (_img: ImageInput) => Promise.resolve(noWarn),
      judgeWarningBold: async (_img: ImageInput) => true,
    };
    const { extracted: out } = await runExtraction([boldProvider], [img("front.jpg")]);
    // The bold pass now runs concurrently with extraction (for latency), but its verdict is only
    // applied when a warning was actually read — here there is none, so the flag stays as-is.
    expect(out.warningPrefixIsBold).toBeNull();
  });

  it("bold-pass is skipped when provider lacks judgeWarningBold — flag left as-is", async () => {
    const withWarn = fields({
      brand: "XYZ",
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: null,
      confidence: { brand: 0.95, warningText: 0.95 },
    });
    const plainProvider: VisionProvider = {
      name: "mock",
      extract: (_img: ImageInput) => Promise.resolve(withWarn),
      // no judgeWarningBold
    };
    const { extracted: out } = await runExtraction([plainProvider], [img("front.jpg")]);
    expect(out.warningPrefixIsBold).toBeNull();
  });
});
