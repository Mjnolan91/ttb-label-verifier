/**
 * reconcile.test.ts (US-010) — the parallel reconciler, proven with two MOCK providers (no network).
 *
 * Covers: agree -> confident, disagree -> low confidence (review), a slow provider aborted at the
 * per-call timeout (reconcile from the one that returned), all-timeout -> TimeoutError, and the
 * field merge rules (one-sided values, tri-state bold).
 */
import { describe, it, expect } from "vitest";
import {
  reconcileExtract,
  mergeExtracted,
  DEFAULT_PER_CALL_TIMEOUT_MS,
  DISAGREEMENT_CONFIDENCE,
} from "./reconcile";
import type { ExtractedFields } from "@/domain";
import type { ImageInput, VisionProvider, VisionProviderName } from "./VisionProvider";

function fields(partial: Partial<ExtractedFields>): ExtractedFields {
  return {
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: {},
    ...partial,
  };
}

function provider(
  name: VisionProviderName,
  impl: (image: ImageInput, signal?: AbortSignal) => Promise<ExtractedFields>,
): VisionProvider {
  return { name, extract: impl };
}

/** A provider that resolves after `ms`, but aborts (clearing its timer) if the signal fires. */
function slowProvider(name: VisionProviderName, ms: number, value: ExtractedFields): VisionProvider {
  return provider(
    name,
    (_img, signal) =>
      new Promise<ExtractedFields>((resolve, reject) => {
        const timer = setTimeout(() => resolve(value), ms);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      }),
  );
}

const IMG: ImageInput = { filename: "x.jpg", data: new Uint8Array([1, 2, 3]) };

describe("reconcileExtract — agreement & disagreement", () => {
  it("agree -> high confidence (max of the two)", async () => {
    const a = provider("llm", () => Promise.resolve(fields({ brand: "Old Tom", confidence: { brand: 0.9 } })));
    const b = provider("ocr", () => Promise.resolve(fields({ brand: "OLD TOM", confidence: { brand: 0.95 } })));
    const r = await reconcileExtract([a, b], IMG);
    expect(r.brand?.toLowerCase()).toBe("old tom");
    expect(r.confidence.brand).toBe(0.95);
  });

  it("disagree -> low confidence so it routes to review", async () => {
    const a = provider("llm", () => Promise.resolve(fields({ brand: "Old Tom Distillery", confidence: { brand: 0.9 } })));
    const b = provider("ocr", () => Promise.resolve(fields({ brand: "New Barrel Co", confidence: { brand: 0.8 } })));
    const r = await reconcileExtract([a, b], IMG);
    expect(r.confidence.brand).toBeLessThanOrEqual(DISAGREEMENT_CONFIDENCE);
    // keeps the higher-confidence value for display
    expect(r.brand).toBe("Old Tom Distillery");
  });
});

describe("reconcileExtract — timeouts (never block on a straggler)", () => {
  it("aborts a slow provider at the per-call timeout and reconciles from the one that returned", async () => {
    const fast = provider("llm", () => Promise.resolve(fields({ brand: "FAST", confidence: { brand: 0.97 } })));
    const slow = slowProvider("ocr", 1000, fields({ brand: "SLOW", confidence: { brand: 0.9 } }));
    const r = await reconcileExtract([fast, slow], IMG, 50);
    expect(r.brand).toBe("FAST"); // slow one was aborted; verify did not block on it
  });

  it("throws a TimeoutError when every provider times out", async () => {
    const slowA = slowProvider("llm", 1000, fields({ brand: "A" }));
    const slowB = slowProvider("ocr", 1000, fields({ brand: "B" }));
    await expect(reconcileExtract([slowA, slowB], IMG, 20)).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("keeps the per-call timeout within the ~5s budget", () => {
    expect(DEFAULT_PER_CALL_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });
});

describe("reconcileExtract — single provider", () => {
  it("returns the single provider's result unchanged", async () => {
    const only = provider("mock", () => Promise.resolve(fields({ brand: "Solo", confidence: { brand: 0.99 } })));
    const r = await reconcileExtract([only], IMG);
    expect(r.brand).toBe("Solo");
    expect(r.confidence.brand).toBe(0.99);
  });
});

describe("mergeExtracted — field rules", () => {
  it("uses a value present in only one provider", () => {
    const a = fields({ brand: "Only-A", confidence: { brand: 0.9 } });
    const b = fields({ warningText: "Only-B warning", confidence: { warningText: 0.8 } });
    const m = mergeExtracted(a, b);
    expect(m.brand).toBe("Only-A");
    expect(m.warningText).toBe("Only-B warning");
  });

  it("prefers a DETECTED bold reading over an undetectable (null) one", () => {
    const ocr = fields({ warningPrefixIsBold: null });
    const llm = fields({ warningPrefixIsBold: true });
    expect(mergeExtracted(ocr, llm).warningPrefixIsBold).toBe(true);
    expect(mergeExtracted(fields({ warningPrefixIsBold: false }), llm).warningPrefixIsBold).toBe(false);
  });
});
