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

describe("runExtraction — a partial image failure is REPORTED, never silent", () => {
  it("reports the failed image (timeout) while reconciling from the survivor", async () => {
    const provider = providerByFilename({
      "front.jpg": () => Promise.resolve(fields({ brand: "ABC", confidence: { brand: 0.95 } })),
      "back.jpg": timeout,
    });
    const out = await runExtraction(
      [provider],
      [{ ...img("back.jpg"), position: "back" }, { ...img("front.jpg"), position: "front" }],
    );
    expect(out.readable).toBe(true);
    expect(out.extracted.brand).toBe("ABC");
    expect(out.failedImages).toEqual([{ filename: "back.jpg", position: "back", reason: "timeout" }]);
  });

  it("classifies a non-timeout failure as reason 'error'", async () => {
    const provider = providerByFilename({
      "front.jpg": () => Promise.resolve(fields({ brand: "ABC", confidence: { brand: 0.95 } })),
      "broken.jpg": () => Promise.reject(new Error("boom")),
    });
    const out = await runExtraction(
      [provider],
      [{ ...img("front.jpg"), position: "front" }, { ...img("broken.jpg"), position: "back" }],
    );
    expect(out.failedImages).toEqual([{ filename: "broken.jpg", position: "back", reason: "error" }]);
  });

  it("reports no failures when every image reads", async () => {
    const provider = providerByFilename({
      "front.jpg": () => Promise.resolve(fields({ brand: "ABC", confidence: { brand: 0.95 } })),
    });
    const out = await runExtraction([provider], [img("front.jpg")]);
    expect(out.failedImages).toEqual([]);
  });
});

describe("runExtraction — origin harvesting after the merge", () => {
  it("fills an absent countryOfOrigin from a printed origin phrase in the commodity statement", async () => {
    const provider = providerByFilename({
      "back.jpg": () =>
        Promise.resolve(
          fields({
            brand: "Cassiopeia",
            commodityStatement: "SPARKLING WINE - PRODUCT OF FRANCE",
            confidence: { brand: 0.95, commodityStatement: 0.9 },
          }),
        ),
    });
    const { extracted } = await runExtraction([provider], [img("back.jpg")]);
    expect(extracted.countryOfOrigin).toBe("PRODUCT OF FRANCE");
    expect(extracted.confidence.countryOfOrigin).toBe(0.9);
  });
});

describe("runExtraction — burst hygiene + rescue budget", () => {
  it("caps the bold-judge fan-out at 3 per image even when extraction samples wider", async () => {
    const prev = process.env.SELF_CONSISTENCY_SAMPLES;
    process.env.SELF_CONSISTENCY_SAMPLES = "5";
    try {
      let extractCalls = 0;
      let judgeCalls = 0;
      const provider: VisionProvider = {
        name: "openai", // any non-"mock" name: the sample count is honored
        extract: async () => {
          extractCalls++;
          return fields({
            brand: "XYZ",
            warningText: CANONICAL_GOVERNMENT_WARNING,
            warningPrefixIsAllCaps: true,
            warningPrefixIsBold: true,
            confidence: { brand: 0.95, warningText: 0.95 },
          });
        },
        judgeWarningBold: async () => {
          judgeCalls++;
          return true;
        },
      };
      const out = await runExtraction([provider], [img("front.jpg")]);
      expect(out.readable).toBe(true);
      expect(extractCalls).toBe(5); // extraction keeps its full consensus width
      expect(judgeCalls).toBe(3); // the boolean judge needs no 5-way burst
    } finally {
      if (prev === undefined) delete process.env.SELF_CONSISTENCY_SAMPLES;
      else process.env.SELF_CONSISTENCY_SAMPLES = prev;
    }
  });

  it("gives the rescue its own budget: a strong read slower than the straggler cap still lands", async () => {
    // Straggler cap 10ms; the strong model takes 50ms. The rescue must NOT race the per-sample cap
    // (a gpt-5.5 read can never finish inside a tight cap), so the agreed value still lifts the field.
    const provider: VisionProvider = {
      name: "mock", // samples forced to 1; extraction instant
      extract: async () =>
        fields({ brand: "Bonnaire", classType: "Champagne", confidence: { brand: 0.6, classType: 0.95 } }),
      readFields: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { brand: "Bonnaire" };
      },
    };
    const out = await runExtraction([provider], [img("front.jpg")], 10);
    expect(out.extracted.confidence.brand ?? 0).toBeGreaterThanOrEqual(0.7); // cross-model agreement cleared the gate
  });
});

describe("runExtraction — JOINT multi-image read (one request per product)", () => {
  /** Pin JOINT_EXTRACTION for a test, restoring the env afterwards. */
  async function withJointEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
    const prev = process.env.JOINT_EXTRACTION;
    if (value === undefined) delete process.env.JOINT_EXTRACTION;
    else process.env.JOINT_EXTRACTION = value;
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.JOINT_EXTRACTION;
      else process.env.JOINT_EXTRACTION = prev;
    }
  }

  const frontBack = [
    { ...img("front.jpg"), position: "front" as const },
    { ...img("back.jpg"), position: "back" as const },
  ];

  it("a capable provider reads ALL images in ONE call — extract() is never used, nothing is reported failed", async () => {
    let jointCalls = 0;
    let singleCalls = 0;
    const provider: VisionProvider = {
      name: "mock", // samples forced to 1: exactly one joint request
      extract: async () => {
        singleCalls++;
        return fields({ brand: "ABC", confidence: { brand: 0.95 } });
      },
      extractAll: async (images) => {
        jointCalls++;
        expect(images.map((i) => i.filename)).toEqual(["front.jpg", "back.jpg"]);
        return fields({
          brand: "ABC",
          warningText: CANONICAL_GOVERNMENT_WARNING,
          warningPrefixIsAllCaps: true,
          warningPrefixIsBold: true,
          confidence: { brand: 0.95, warningText: 0.95 },
        });
      },
    };
    const out = await runExtraction([provider], frontBack);
    expect(jointCalls).toBe(1);
    expect(singleCalls).toBe(0);
    expect(out.readable).toBe(true);
    expect(out.extracted.brand).toBe("ABC");
    expect(out.extracted.warningText).toContain("GOVERNMENT WARNING");
    expect(out.failedImages).toEqual([]); // all-or-nothing: no partial drop is possible
  });

  it("JOINT_EXTRACTION=0 falls back to per-image reads + merge", async () => {
    await withJointEnv("0", async () => {
      let jointCalls = 0;
      let singleCalls = 0;
      const provider: VisionProvider = {
        name: "mock",
        extract: async () => {
          singleCalls++;
          return fields({ brand: "ABC", confidence: { brand: 0.95 } });
        },
        extractAll: async () => {
          jointCalls++;
          return fields({ brand: "ABC", confidence: { brand: 0.95 } });
        },
      };
      const out = await runExtraction([provider], frontBack);
      expect(singleCalls).toBe(2);
      expect(jointCalls).toBe(0);
      expect(out.extracted.brand).toBe("ABC");
    });
  });

  it("a SINGLE-image product stays on the per-image path (no joint preamble for one image)", async () => {
    let jointCalls = 0;
    let singleCalls = 0;
    const provider: VisionProvider = {
      name: "mock",
      extract: async () => {
        singleCalls++;
        return fields({ brand: "ABC", confidence: { brand: 0.95 } });
      },
      extractAll: async () => {
        jointCalls++;
        return fields({ brand: "ABC", confidence: { brand: 0.95 } });
      },
    };
    await runExtraction([provider], [img("front.jpg")]);
    expect(singleCalls).toBe(1);
    expect(jointCalls).toBe(0);
  });

  it("a model-reported CROSS-IMAGE CONFLICT is capped into the review band — never a confident pass", async () => {
    // The joint read picked the front's 45% at high confidence but flagged the back's contradiction.
    const provider: VisionProvider = {
      name: "mock",
      extract: async () => fields({}),
      extractAll: async () =>
        fields({
          brand: "ABC",
          alcoholContentText: "45% Alc./Vol.",
          crossImageConflicts: ["alcoholContent"],
          confidence: { brand: 0.95, alcoholContent: 0.98 },
        }),
    };
    const out = await runExtraction([provider], frontBack);
    expect(out.extracted.alcoholContentText).toBe("45% Alc./Vol."); // the suggestion survives for the human
    expect(out.extracted.confidence.alcoholContent).toBeLessThanOrEqual(0.3); // verdict routes to review
    expect(out.extracted.confidence.brand).toBe(0.95); // unlisted fields untouched
  });

  it("a joint read that times out entirely surfaces the TimeoutError (re-upload path)", async () => {
    const provider: VisionProvider = {
      name: "mock",
      extract: async () => fields({}),
      extractAll: timeout,
    };
    await expect(runExtraction([provider], frontBack)).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("a provider WITHOUT extractAll keeps the per-image path (mock/ocr/ensemble unaffected)", async () => {
    const provider = providerByFilename({
      "front.jpg": () => Promise.resolve(fields({ brand: "ABC", confidence: { brand: 0.95 } })),
      "back.jpg": () => Promise.resolve(fields({ netContents: "750 mL", confidence: { netContents: 0.9 } })),
    });
    const out = await runExtraction([provider], frontBack);
    expect(out.extracted.brand).toBe("ABC");
    expect(out.extracted.netContents).toBe("750 mL");
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

  it("a hung judgeWarningBold cannot stall the read past the per-call timeout (cannot-assert)", async () => {
    const extracted = fields({
      brand: "XYZ",
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: true,
      confidence: { brand: 0.95, warningText: 0.95 },
    });
    const hung: VisionProvider = {
      name: "mock",
      extract: (_img: ImageInput) => Promise.resolve(extracted),
      judgeWarningBold: (_img: ImageInput) => new Promise<boolean | null>(() => {}), // never settles
    };
    const started = Date.now();
    const { extracted: out } = await runExtraction([hung], [img("front.jpg")], 120);
    // Bounded by the per-call timeout (not the provider's ~30s hard cap), and the unsettled judge
    // contributes null ("cannot assert"), so the extraction model's own bold flag stands.
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.warningPrefixIsBold).toBe(true);
  });

  it("hard-fails 'not bold' only when BOTH the extraction flag and the judge agree", async () => {
    const extracted = fields({
      brand: "XYZ",
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: false,
      confidence: { brand: 0.95, warningText: 0.95 },
    });
    const provider: VisionProvider = {
      name: "mock",
      extract: (_img: ImageInput) => Promise.resolve(extracted),
      judgeWarningBold: async (_img: ImageInput) => false,
    };
    const { extracted: out } = await runExtraction([provider], [img("front.jpg")]);
    expect(out.warningPrefixIsBold).toBe(false);
  });

  it("softens a lone 'not bold' to null (no false reject) when the judge cannot confirm it", async () => {
    const extracted = fields({
      brand: "XYZ",
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: false,
      confidence: { brand: 0.95, warningText: 0.95 },
    });
    const provider: VisionProvider = {
      name: "mock",
      extract: (_img: ImageInput) => Promise.resolve(extracted),
      judgeWarningBold: async (_img: ImageInput) => null,
    };
    const { extracted: out } = await runExtraction([provider], [img("front.jpg")]);
    // Extraction alone said "not bold" but the dedicated judge can't confirm -> surfaced, not hard-failed.
    expect(out.warningPrefixIsBold).toBeNull();
  });
});
