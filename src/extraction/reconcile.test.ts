/**
 * reconcile.test.ts — the parallel reconciler, proven with two MOCK providers (no network).
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

  it("prefers a DETECTED bold reading over an undetectable (null) one when both read the warning", () => {
    // Same-image ensemble: both providers read the warning; one detects bold, the other can't (null).
    const warn = { warningText: "GOVERNMENT WARNING: (1) ...", confidence: { warningText: 0.9 } };
    const ocr = fields({ ...warn, warningPrefixIsBold: null });
    const llm = fields({ ...warn, warningPrefixIsBold: true });
    expect(mergeExtracted(ocr, llm).warningPrefixIsBold).toBe(true);
    expect(mergeExtracted(fields({ ...warn, warningPrefixIsBold: false }), llm).warningPrefixIsBold).toBe(false);
  });

  it("takes the warning flags from the warning-bearing image (front no-warning / back warning split)", () => {
    // The front carries NO warning (and a model legitimately reports allCaps:false / bold:false for the
    // absent prefix); the back carries the real warning with undetectable bold. The merge must use the
    // BACK's flags — a clean back-label warning must not be falsely rejected by the front's defaults.
    const front = fields({ warningText: "", warningPrefixIsAllCaps: false, warningPrefixIsBold: false });
    const back = fields({
      warningText: "GOVERNMENT WARNING: (1) ...",
      warningPrefixIsAllCaps: true,
      warningPrefixIsBold: null,
      confidence: { warningText: 0.95 },
    });
    for (const m of [mergeExtracted(front, back), mergeExtracted(back, front)]) {
      expect(m.warningText).toContain("GOVERNMENT WARNING");
      expect(m.warningPrefixIsAllCaps).toBe(true); // from the back, not the front's false
      expect(m.warningPrefixIsBold).toBeNull(); // front's spurious false must NOT overwrite the back's null
    }
  });

  it("treats a punctuation/spacing-only difference as agreement, not a review", () => {
    const a = fields({ netContents: "750 mL", confidence: { netContents: 0.9 } });
    const b = fields({ netContents: "750ml", confidence: { netContents: 0.85 } });
    // Tolerant agreement -> keep the max confidence rather than down-weighting to review.
    expect(mergeExtracted(a, b).confidence.netContents).toBe(0.9);
  });

  it("still routes a genuinely divergent read to review", () => {
    const a = fields({ name: "ABC Distillery", confidence: { name: 0.9 } });
    const b = fields({ name: "XYZ Imports", confidence: { name: 0.9 } });
    expect(mergeExtracted(a, b).confidence.name).toBeLessThanOrEqual(DISAGREEMENT_CONFIDENCE);
  });

  it("treats containment of a short identity field as agreement and keeps the more complete value", () => {
    // Front prints a shortened producer name; back prints the full one. This is the common
    // front/back case that used to crater brand/name confidence to 0.3 and keep the shorter value.
    const front = fields({ name: "OLD TOM", confidence: { name: 0.9 } });
    const back = fields({ name: "Old Tom Distillery", confidence: { name: 0.9 } });
    const merged = mergeExtracted(front, back);
    expect(merged.name).toBe("Old Tom Distillery"); // the more complete value
    expect(merged.confidence.name ?? 0).toBeGreaterThanOrEqual(0.9); // not cratered to review
  });

  it("prefers the more complete brand even when the shorter read has higher confidence", () => {
    const front = fields({ brand: "OLD TOM", confidence: { brand: 0.95 } });
    const back = fields({ brand: "Old Tom Distillery", confidence: { brand: 0.9 } });
    expect(mergeExtracted(front, back).brand).toBe("Old Tom Distillery");
  });
});

describe("mergeExtracted — numbers are load-bearing (digit noise must not pose as agreement)", () => {
  it("routes a dropped-digit ABV (4% vs 14%) to review — containment must not bridge numbers", () => {
    // "4alcvol" is a canonical substring of "14alcvol": text-level containment, but a totally
    // different ABV. Asserting it at max confidence could drive a wrong tolerance/exemption verdict.
    const a = fields({ alcoholContentText: "14% Alc./Vol.", confidence: { alcoholContent: 0.95 } });
    const b = fields({ alcoholContentText: "4% Alc./Vol.", confidence: { alcoholContent: 0.9 } });
    expect(mergeExtracted(a, b).confidence.alcoholContent).toBeLessThanOrEqual(DISAGREEMENT_CONFIDENCE);
  });

  it("routes a dropped-digit net contents (750 vs 1750 mL) to review", () => {
    const a = fields({ netContents: "1750 mL", confidence: { netContents: 0.95 } });
    const b = fields({ netContents: "750 mL", confidence: { netContents: 0.9 } });
    expect(mergeExtracted(a, b).confidence.netContents).toBeLessThanOrEqual(DISAGREEMENT_CONFIDENCE);
  });

  it("routes a one-digit substitution in a long statement (45% vs 15%) to review — similarity must not bridge it", () => {
    // One character out of ~24 differs, so normalized similarity is ~0.96 — but the ABV is wrong by 30 points.
    const a = fields({ alcoholContentText: "45% Alc./Vol. (90 Proof)", confidence: { alcoholContent: 0.95 } });
    const b = fields({ alcoholContentText: "15% Alc./Vol. (90 Proof)", confidence: { alcoholContent: 0.9 } });
    expect(mergeExtracted(a, b).confidence.alcoholContent).toBeLessThanOrEqual(DISAGREEMENT_CONFIDENCE);
  });

  it("a one-sided EXTRA number is still agreement (proof printed on one read only)", () => {
    const a = fields({ alcoholContentText: "45% Alc./Vol. (90 Proof)", confidence: { alcoholContent: 0.9 } });
    const b = fields({ alcoholContentText: "45% Alc./Vol.", confidence: { alcoholContent: 0.95 } });
    expect(mergeExtracted(a, b).confidence.alcoholContent).toBe(0.95);
  });
});
