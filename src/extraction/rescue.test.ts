/**
 * rescue.test.ts — the low-confidence strong-model rescue: eligibility + fold-in semantics.
 *
 * The safety contract under test: a rescue can CLEAR a false alarm (cross-model agreement rises
 * above the review gate) but can never silently flip a genuine conflict to pass (disagreement is
 * capped below the gate), and it never touches fields outside the contested set.
 */
import { describe, expect, it } from "vitest";
import type { ExtractedFields } from "@/domain";
import { FIELD_REVIEW_CONFIDENCE } from "@/compare";
import {
  RESCUE_AGREED_CONFIDENCE,
  RESCUE_CONTESTED_CONFIDENCE,
  applyRescue,
  rescueEligibleKeys,
  rescueRawKeys,
} from "./rescue";

function extracted(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brand: "Old Tom Distillery",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    warningRemainderIsBold: null,
    warningIsReadilyLegible: null,
    confidence: { brand: 0.95, classType: 0.95, alcoholContent: 0.95, netContents: 0.95 },
    ...overrides,
  } as ExtractedFields;
}

describe("rescue constants sit on the right sides of the review gate", () => {
  it("agreement clears the gate; disagreement stays below it", () => {
    expect(RESCUE_AGREED_CONFIDENCE).toBeGreaterThanOrEqual(FIELD_REVIEW_CONFIDENCE);
    expect(RESCUE_CONTESTED_CONFIDENCE).toBeLessThan(FIELD_REVIEW_CONFIDENCE);
  });
});

describe("rescueEligibleKeys — only contested, present, verdict-relevant fields", () => {
  it("picks the borderline field and nothing else", () => {
    const e = extracted({ confidence: { brand: 0.6, classType: 0.95, alcoholContent: 0.95, netContents: 0.95 } });
    expect(rescueEligibleKeys(e)).toEqual(["brand"]);
  });

  it("ignores confident fields, zero-confidence fields, and absent values", () => {
    const e = extracted({
      brand: "", // absent: nothing for the strong model to referee
      confidence: { brand: 0.6, classType: 0, alcoholContent: 0.7, netContents: 0.95 },
    });
    // brand absent, classType at 0, alcohol AT the gate (not below), net confident.
    expect(rescueEligibleKeys(e)).toEqual([]);
  });

  it("never selects long-tail fields (verdict-relevant set only)", () => {
    const e = extracted({
      fancifulName: "Midnight Reserve",
      confidence: { brand: 0.95, classType: 0.95, alcoholContent: 0.95, netContents: 0.95, fancifulName: 0.4 },
    });
    expect(rescueEligibleKeys(e)).toEqual([]);
  });

  it("maps rescue keys to the model-facing raw keys (alcohol is the renamed one)", () => {
    expect(rescueRawKeys(["brand", "alcoholContent"])).toEqual(["brand", "alcoholContent"]);
  });
});

describe("applyRescue — agree boosts, disagree adopts-but-stays-review, null leaves alone", () => {
  it("cross-model agreement clears the review gate and keeps the fuller form", () => {
    const e = extracted({ confidence: { brand: 0.6, classType: 0.95, alcoholContent: 0.95, netContents: 0.95 } });
    applyRescue(e, ["brand"], { brand: "Old Tom Distillery Co." }); // containment: agreement, fuller
    expect(e.confidence.brand).toBe(RESCUE_AGREED_CONFIDENCE);
    expect(e.brand).toBe("Old Tom Distillery Co.");
  });

  it("cross-model disagreement adopts the strong read but stays below the gate", () => {
    const e = extracted({ confidence: { brand: 0.6, classType: 0.95, alcoholContent: 0.95, netContents: 0.95 } });
    applyRescue(e, ["brand"], { brand: "Black Cat Spirits" });
    expect(e.brand).toBe("Black Cat Spirits");
    expect(e.confidence.brand).toBe(RESCUE_CONTESTED_CONFIDENCE);
  });

  it("a numeric difference is NEVER agreement: the alcohol statement adopts at the cap", () => {
    const e = extracted({ confidence: { brand: 0.95, classType: 0.95, alcoholContent: 0.65, netContents: 0.95 } });
    applyRescue(e, ["alcoholContent"], { alcoholContent: "46% Alc./Vol. (92 Proof)" });
    expect(e.alcoholContentText).toBe("46% Alc./Vol. (92 Proof)");
    expect(e.confidence.alcoholContent).toBe(RESCUE_CONTESTED_CONFIDENCE);
  });

  it("a null strong read changes nothing (still routes to review as before)", () => {
    const e = extracted({ confidence: { brand: 0.6, classType: 0.95, alcoholContent: 0.95, netContents: 0.95 } });
    applyRescue(e, ["brand"], { brand: null });
    expect(e.brand).toBe("Old Tom Distillery");
    expect(e.confidence.brand).toBe(0.6);
  });

  it("never lowers an already-confident field on agreement", () => {
    const e = extracted({ confidence: { brand: 0.9, classType: 0.95, alcoholContent: 0.95, netContents: 0.95 } });
    applyRescue(e, ["brand"], { brand: "Old Tom Distillery" });
    expect(e.confidence.brand).toBe(0.9); // max(current, 0.85)
  });
});
