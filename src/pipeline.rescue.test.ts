/**
 * pipeline.rescue.test.ts — the rescue pass wired into runExtraction.
 *
 * Locks the orchestration contract: the strong re-read fires ONLY when a provider supports it, the
 * env knob is on, and a verdict-relevant field is contested; it sees ALL the product's images and
 * exactly the contested raw keys; and a failed rescue leaves the extraction untouched. The mock
 * provider has no readFields, so the offline suite/eval can never enter this path (also asserted).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtractedFields } from "@/domain";
import type { ImageInput, VisionProvider } from "@/extraction";
import { MockVisionProvider } from "@/extraction";
import { RESCUE_AGREED_CONFIDENCE, RESCUE_CONTESTED_CONFIDENCE } from "./extraction/rescue";
import { runExtraction } from "./pipeline";

afterEach(() => {
  vi.unstubAllEnvs();
});

function lowConfBrandRead(): ExtractedFields {
  return {
    brand: "Old Tom Distillery",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    warningRemainderIsBold: null,
    warningIsReadilyLegible: null,
    confidence: { brand: 0.6, classType: 0.95, alcoholContent: 0.95, netContents: 0.95 },
  } as ExtractedFields;
}

function fakeProvider(readFields?: VisionProvider["readFields"]): VisionProvider {
  return {
    // "mock" keeps the pipeline on 1 sample (deterministic), exactly like the offline suite.
    name: "mock",
    extract: async () => lowConfBrandRead(),
    ...(readFields ? { readFields } : {}),
  };
}

const IMAGES: ImageInput[] = [
  { filename: "front.png", position: "front" },
  { filename: "back.png", position: "back" },
];

describe("runExtraction — low-confidence rescue orchestration", () => {
  it("re-reads the contested field on the strong model: all images, exactly the contested keys", async () => {
    const readFields = vi.fn(async () => ({ brand: "Old Tom Distillery" }));
    const { extracted } = await runExtraction([fakeProvider(readFields)], IMAGES);

    expect(readFields).toHaveBeenCalledTimes(1);
    const [images, rawKeys] = readFields.mock.calls[0] as unknown as [ImageInput[], string[]];
    expect(images).toHaveLength(2); // the rescue sees front AND back
    expect(rawKeys).toEqual(["brand"]);
    expect(extracted.confidence.brand).toBe(RESCUE_AGREED_CONFIDENCE); // agreement cleared the gate
  });

  it("adopts a disagreeing strong read but keeps the field in the review band", async () => {
    const readFields = vi.fn(async () => ({ brand: "Black Cat Spirits" }));
    const { extracted } = await runExtraction([fakeProvider(readFields)], IMAGES);
    expect(extracted.brand).toBe("Black Cat Spirits");
    expect(extracted.confidence.brand).toBe(RESCUE_CONTESTED_CONFIDENCE);
  });

  it("LOW_CONFIDENCE_RESCUE=0 disables the pass", async () => {
    vi.stubEnv("LOW_CONFIDENCE_RESCUE", "0");
    const readFields = vi.fn(async () => ({ brand: "Old Tom Distillery" }));
    const { extracted } = await runExtraction([fakeProvider(readFields)], IMAGES);
    expect(readFields).not.toHaveBeenCalled();
    expect(extracted.confidence.brand).toBe(0.6);
  });

  it("does not fire when nothing is contested", async () => {
    const readFields = vi.fn(async () => ({}));
    const confident: VisionProvider = {
      name: "mock",
      extract: async () => ({ ...lowConfBrandRead(), confidence: { brand: 0.95, classType: 0.95, alcoholContent: 0.95, netContents: 0.95 } }) as ExtractedFields,
      readFields,
    };
    await runExtraction([confident], IMAGES);
    expect(readFields).not.toHaveBeenCalled();
  });

  it("a failed rescue leaves the extraction untouched", async () => {
    const readFields = vi.fn(async () => {
      throw new Error("strong model unavailable");
    });
    const { extracted } = await runExtraction([fakeProvider(readFields)], IMAGES);
    expect(extracted.brand).toBe("Old Tom Distillery");
    expect(extracted.confidence.brand).toBe(0.6);
  });

  it("the real mock provider has no readFields: the offline path can never rescue", () => {
    const mock: VisionProvider = new MockVisionProvider();
    expect(mock.readFields).toBeUndefined();
  });
});
