/**
 * secondLook.test.ts — the delayed targeted retry's safety semantics:
 *  - only MISSING completeness elements schedule (malformed/present never do);
 *  - recoveries land at review-band confidence (0.65, below the 0.7 trust gate) — caught and
 *    surfaced, never silently passed;
 *  - the merge fills EMPTY fields only, never overwrites, never touches a cross-image hold,
 *    never sets warning format flags;
 *  - a provider without readFields (the mock) reports the pass unsupported (null).
 */
import { describe, expect, it } from "vitest";
import type { ExtractedFields } from "@/domain";
import { checkCompleteness } from "@/compare";
import {
  SECOND_LOOK_CONFIDENCE,
  applySecondLook,
  secondLookKeysFor,
  secondLookLabel,
} from "./secondLook";
import { runSecondLook } from "./secondLookServer";
import type { ImageInput, VisionProvider } from "./VisionProvider";

/** A spirits read missing its back-label facts (net contents, warning, responsibility line). */
function frontOnlySpirits(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brand: "Old Tom Distillery",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    warningPrefixIsAllCaps: null,
    warningPrefixIsBold: null,
    confidence: { brand: 0.97, classType: 0.95, alcoholContent: 0.96 },
    ...overrides,
  };
}

function stubProvider(readFields: VisionProvider["readFields"]): VisionProvider {
  return {
    name: "llm",
    extract: async () => frontOnlySpirits(),
    ...(readFields ? { readFields } : {}),
  } as unknown as VisionProvider;
}

const IMAGES: ImageInput[] = [{ filename: "x-front.jpg" }, { filename: "x-back.jpg" }];

describe("secondLookKeysFor", () => {
  it("maps MISSING mandatory elements to their extraction channels, in catalog order", () => {
    const e = frontOnlySpirits();
    const keys = secondLookKeysFor(e, checkCompleteness(e));
    expect(keys).toContain("netContents");
    expect(keys).toContain("warningText");
    expect(keys).toContain("name");
    expect(keys).toContain("address");
    // Present fields never qualify, however the elements read.
    expect(keys).not.toContain("brand");
    expect(keys).not.toContain("alcoholContent");
    // Catalog order: netContents (headline) precedes warningText.
    expect(keys.indexOf("netContents")).toBeLessThan(keys.indexOf("warningText"));
  });

  it("excludes MALFORMED elements (the text was read; re-reading cannot fix the print)", () => {
    const e = frontOnlySpirits({ netContents: "740 mL" }); // not an authorized standard of fill
    e.confidence.netContents = 0.95;
    const keys = secondLookKeysFor(e, checkCompleteness(e));
    expect(keys).not.toContain("netContents");
  });

  it("excludes a field held by a cross-image conflict (a deliberate review hold)", () => {
    const e = frontOnlySpirits({ crossImageConflicts: ["netContents"] });
    const keys = secondLookKeysFor(e, checkCompleteness(e));
    expect(keys).not.toContain("netContents");
    expect(keys).toContain("warningText"); // the rest still schedules
  });

  it("returns [] without a completeness result", () => {
    expect(secondLookKeysFor(frontOnlySpirits(), undefined)).toEqual([]);
  });
});

describe("runSecondLook", () => {
  it("returns recoveries at review-band confidence and omits fields the strong model couldn't read", async () => {
    const provider = stubProvider(async (_imgs, rawKeys) => {
      expect(rawKeys).toEqual(["netContents", "warningText"]);
      return { netContents: "750 mL", warningText: null };
    });
    const found = await runSecondLook(provider, IMAGES, ["netContents", "warningText"], 5_000);
    expect(found).toEqual({ netContents: { value: "750 mL", confidence: SECOND_LOOK_CONFIDENCE } });
    expect(SECOND_LOOK_CONFIDENCE).toBeLessThan(0.7); // review-gated by construction
  });

  it("reports unsupported (null) when the provider has no readFields (the offline mock)", async () => {
    const provider = stubProvider(undefined);
    expect(await runSecondLook(provider, IMAGES, ["netContents"], 5_000)).toBeNull();
  });

  it("returns null when the focused read fails outright (bounded, never throws)", async () => {
    const provider = stubProvider(async () => {
      throw new Error("provider down");
    });
    expect(await runSecondLook(provider, IMAGES, ["netContents"], 5_000)).toBeNull();
  });

  it("returns {} when the strong model finds nothing (ran, still missing — distinct from unsupported)", async () => {
    const provider = stubProvider(async () => ({ netContents: null }));
    expect(await runSecondLook(provider, IMAGES, ["netContents"], 5_000)).toEqual({});
  });
});

describe("applySecondLook", () => {
  it("fills empty fields immutably and reports what it filled", () => {
    const e = frontOnlySpirits();
    const { merged, filled } = applySecondLook(e, {
      netContents: { value: "750 mL", confidence: SECOND_LOOK_CONFIDENCE },
    });
    expect(merged.netContents).toBe("750 mL");
    expect(merged.confidence.netContents).toBe(SECOND_LOOK_CONFIDENCE);
    expect(filled).toEqual(["netContents"]);
    expect(e.netContents).toBeUndefined(); // the original row state is untouched
  });

  it("collapses a twice-printed fact in the focused read before filling (same rule as the mapper)", () => {
    const e = frontOnlySpirits();
    const { merged } = applySecondLook(e, {
      netContents: { value: "750 ML 750ml", confidence: SECOND_LOOK_CONFIDENCE },
    });
    expect(merged.netContents).toBe("750 ML");
  });

  it("never overwrites a present value and never touches a cross-image hold", () => {
    const e = frontOnlySpirits({ netContents: "750 mL", crossImageConflicts: ["name"] });
    e.confidence.netContents = 0.95;
    const { merged, filled } = applySecondLook(e, {
      netContents: { value: "375 mL", confidence: SECOND_LOOK_CONFIDENCE },
      name: { value: "Someone Else", confidence: SECOND_LOOK_CONFIDENCE },
    });
    expect(merged.netContents).toBe("750 mL");
    expect(merged.confidence.netContents).toBe(0.95);
    expect(merged.name).toBeUndefined();
    expect(filled).toEqual([]);
  });

  it("a recovered warning carries its transcript only — the format flags stay as the read left them", () => {
    const e = frontOnlySpirits();
    const { merged } = applySecondLook(e, {
      warningText: { value: "GOVERNMENT WARNING: (1) ...", confidence: SECOND_LOOK_CONFIDENCE },
    });
    expect(merged.warningText).toBe("GOVERNMENT WARNING: (1) ...");
    expect(merged.warningPrefixIsAllCaps).toBeNull();
    expect(merged.warningPrefixIsBold).toBeNull();
  });
});

describe("secondLookLabel", () => {
  it("names channels with their catalog labels for the row note", () => {
    expect(secondLookLabel("netContents")).toBe("Net contents");
    expect(secondLookLabel("warningText").toLowerCase()).toContain("warning");
  });
});
