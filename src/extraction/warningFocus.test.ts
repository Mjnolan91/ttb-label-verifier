/**
 * warningFocus.test.ts — the dedicated warning escalation: trigger, asymmetric application,
 * two-stage orchestration (locate -> crop -> re-judge), and the defensive JSON coercion.
 * All offline: fake providers + an injectable cropper; sharp is never loaded here.
 */
import { describe, it, expect } from "vitest";
import {
  applyWarningFocus,
  coerceWarningFocusRead,
  runWarningFocus,
  warningFocusNeeded,
} from "./warningFocus";
import { RESCUE_AGREED_CONFIDENCE, RESCUE_CONTESTED_CONFIDENCE, applyRescue } from "./rescue";
import { combineViolationSignals } from "./boldJudgment";
import type { ImageInput, VisionProvider, WarningFocusRead } from "./VisionProvider";
import type { ExtractedFields } from "@/domain";
import { CANONICAL_GOVERNMENT_WARNING } from "@/domain";

function fields(partial: Partial<ExtractedFields>): ExtractedFields {
  return { warningPrefixIsAllCaps: true, warningPrefixIsBold: true, confidence: {}, ...partial };
}

function focusRead(partial: Partial<WarningFocusRead>): WarningFocusRead {
  return {
    found: true,
    imageIndex: 0,
    transcript: CANONICAL_GOVERNMENT_WARNING,
    prefixAllCaps: true,
    prefixBold: true,
    remainderBold: false,
    readilyLegible: true,
    rotateClockwise: 0,
    box: { left: 0.1, top: 0.6, width: 0.8, height: 0.1 },
    ...partial,
  };
}

const img = (filename: string): ImageInput => ({ filename, data: new Uint8Array([1]) });

describe("warningFocusNeeded — fires only when the warning is required AND unsettled", () => {
  it("missing warning on a 33% ABV product -> needed", () => {
    expect(
      warningFocusNeeded(fields({ alcoholContentText: "ALC. 33% BY VOL. (66 PROOF)", warningText: "" })),
    ).toBe(true);
  });

  it("missing warning with UNKNOWN ABV -> needed (conservative: requirement assumed)", () => {
    expect(warningFocusNeeded(fields({ warningText: undefined }))).toBe(true);
  });

  it("exempt product (<0.5% ABV at a TRUSTED read) -> never needed, even with no warning", () => {
    expect(
      warningFocusNeeded(
        fields({ alcoholContentText: "0.4% ALC/VOL", warningText: "", confidence: { alcoholContent: 0.95 } }),
      ),
    ).toBe(false);
  });

  it("an UNTRUSTED sub-0.5% read does not exempt (decimal-slip misreads must not bury the warning)", () => {
    expect(
      warningFocusNeeded(
        fields({ alcoholContentText: "0.4% ALC/VOL", warningText: "", confidence: { alcoholContent: 0.3 } }),
      ),
    ).toBe(true);
  });

  it("a CONFLICT-stamped warning (<= 0.3 with text) never triggers — the hold stays with a human", () => {
    expect(
      warningFocusNeeded(
        fields({ warningText: CANONICAL_GOVERNMENT_WARNING, confidence: { warningText: 0.3 } }),
      ),
    ).toBe(false);
  });

  it("a rescue-adopted warning (strongReadAdopted) never re-triggers — same-model self-agreement is not evidence", () => {
    expect(
      warningFocusNeeded(
        fields({
          warningText: CANONICAL_GOVERNMENT_WARNING,
          strongReadAdopted: ["warningText"],
          confidence: { warningText: 0.65 },
        }),
      ),
    ).toBe(false);
  });

  it("warning present but below the review gate -> needed", () => {
    expect(
      warningFocusNeeded(
        fields({ warningText: CANONICAL_GOVERNMENT_WARNING, confidence: { warningText: 0.6 } }),
      ),
    ).toBe(true);
  });

  it("warning present and confident but the BOLD flag is unverified (null) -> needed (the Fireball case)", () => {
    expect(
      warningFocusNeeded(
        fields({
          warningText: CANONICAL_GOVERNMENT_WARNING,
          warningPrefixIsBold: null,
          confidence: { warningText: 1 },
        }),
      ),
    ).toBe(true);
  });

  it("fully verified warning -> not needed (the common case costs nothing)", () => {
    expect(
      warningFocusNeeded(
        fields({ warningText: CANONICAL_GOVERNMENT_WARNING, confidence: { warningText: 1 } }),
      ),
    ).toBe(false);
  });
});

describe("applyWarningFocus — asymmetric application", () => {
  it("RECOVERY: a missed warning surfaces at review-band confidence, never a silent pass", () => {
    const e = fields({ warningText: "", warningPrefixIsAllCaps: null, warningPrefixIsBold: null });
    applyWarningFocus(e, focusRead({}));
    expect(e.warningText).toBe(CANONICAL_GOVERNMENT_WARNING);
    expect(e.confidence.warningText).toBe(RESCUE_CONTESTED_CONFIDENCE); // < 0.7: stays with a human
    expect(e.warningPrefixIsAllCaps).toBe(true); // focus verdicts adopted (fast read saw nothing)
    expect(e.warningPrefixIsBold).toBe(true);
  });

  it("RECOVERY: a lone violation signal from the single focus read softens to null (never hard-fails)", () => {
    const e = fields({ warningText: "" });
    applyWarningFocus(e, focusRead({ prefixAllCaps: false, prefixBold: false, remainderBold: true }));
    expect(e.warningPrefixIsAllCaps).toBeNull();
    expect(e.warningPrefixIsBold).toBeNull();
    expect(e.warningRemainderIsBold).toBeNull();
  });

  it("AGREEMENT: two independent reads clear the review gate and keep the fuller form", () => {
    const truncated = CANONICAL_GOVERNMENT_WARNING.slice(0, 200);
    const e = fields({ warningText: truncated, confidence: { warningText: 0.6 } });
    applyWarningFocus(e, focusRead({}));
    expect(e.warningText).toBe(CANONICAL_GOVERNMENT_WARNING);
    expect(e.confidence.warningText).toBe(RESCUE_AGREED_CONFIDENCE);
  });

  it("CONFLICT on a CONTESTED read: the focus transcript is adopted as the suggestion, stays in review", () => {
    const e = fields({
      warningText: "GOVERNMENT WARNING: completely different words here that do not agree at all with anything",
      confidence: { warningText: 0.6 },
    });
    applyWarningFocus(e, focusRead({}));
    expect(e.warningText).toBe(CANONICAL_GOVERNMENT_WARNING);
    expect(e.confidence.warningText).toBe(RESCUE_CONTESTED_CONFIDENCE);
  });

  it("CONFLICT against a CONFIDENT consensus: the settled text stands, only flags are contributed", () => {
    // Live-measured 2026-06-11: a rotated crop's clipped re-read must never replace a perfect
    // multi-sample transcript. The flags-only trigger still gets its flag verified below.
    const e = fields({
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsBold: null,
      confidence: { warningText: 1 },
    });
    applyWarningFocus(e, focusRead({ transcript: "GOVERNMENT WARNING: a clipped garbled fragment" }));
    expect(e.warningText).toBe(CANONICAL_GOVERNMENT_WARNING);
    expect(e.confidence.warningText).toBe(1);
    expect(e.warningPrefixIsBold).toBe(true); // the pass still verified the flag
  });

  it("FLAG FILL: an unverified bold (null) is verified by a focus TRUE — the Fireball fix", () => {
    const e = fields({
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsBold: null,
      confidence: { warningText: 1 },
    });
    applyWarningFocus(e, focusRead({ transcript: null })); // flags-only read still applies
    expect(e.warningPrefixIsBold).toBe(true);
    expect(e.confidence.warningText).toBe(1); // text untouched when the focus read carries none
  });

  it("FLAG GUARD: focus FALSE against an extraction null stays null (lone not-bold never hard-fails)", () => {
    const e = fields({
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsBold: null,
      confidence: { warningText: 1 },
    });
    applyWarningFocus(e, focusRead({ prefixBold: false }));
    expect(e.warningPrefixIsBold).toBeNull();
  });

  it("FLAG GUARD: a lone focus 'remainder is bold' (the TRUE-fails flag) stays null", () => {
    const e = fields({
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningRemainderIsBold: null,
      confidence: { warningText: 1 },
    });
    applyWarningFocus(e, focusRead({ remainderBold: true }));
    expect(e.warningRemainderIsBold).toBeNull();
  });

  it("NOT FOUND: nothing changes (an honest missing stays missing)", () => {
    const e = fields({ warningText: "", confidence: {} });
    applyWarningFocus(e, focusRead({ found: false, transcript: null }));
    expect(e.warningText).toBe("");
    expect(e.confidence.warningText).toBeUndefined();
  });

  it("a found:false read contributes NOTHING — stray flags from it never fill a null", () => {
    // "Verified" must never rest on a read that claims the warning does not exist.
    const e = fields({
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsBold: null,
      confidence: { warningText: 1 },
    });
    applyWarningFocus(e, focusRead({ found: false, transcript: null, prefixBold: true }));
    expect(e.warningPrefixIsBold).toBeNull();
  });

  it("CONFLICT BAND is fully untouchable: no boost, no adoption, no flag fills (FP-3 guard)", () => {
    // A cross-panel contradiction capped to 0.3 must reach a human; an agreeing focus read must
    // not arbitrate it (adversarial review blocker: this was a false-approval path).
    const e = fields({
      warningText: CANONICAL_GOVERNMENT_WARNING,
      warningPrefixIsAllCaps: null,
      warningPrefixIsBold: null,
      crossImageConflicts: ["warningText"],
      confidence: { warningText: 0.3 },
    });
    applyWarningFocus(e, focusRead({}));
    expect(e.confidence.warningText).toBe(0.3); // the hold survives an agreeing strong read
    expect(e.warningPrefixIsBold).toBeNull(); // and its flags contribute nothing
    expect(e.warningPrefixIsAllCaps).toBeNull();
  });

  it("RESCUE-ADOPTED text never self-agrees past the gate (the same model's words are not new evidence)", () => {
    // applyRescue's contested branch adopts the strong read at 0.65 AND marks it; a focus read by
    // the same model trivially "agreeing" must not boost to 0.85.
    const e = fields({
      warningText: "GOVERNMENT WARNING: a paraphrase the fast reads saw",
      confidence: { warningText: 0.67 },
    });
    applyRescue(e, ["warningText"], { warningText: CANONICAL_GOVERNMENT_WARNING });
    expect(e.warningText).toBe(CANONICAL_GOVERNMENT_WARNING); // adopted as the suggestion
    expect(e.confidence.warningText).toBe(RESCUE_CONTESTED_CONFIDENCE); // held in review
    expect(e.strongReadAdopted).toContain("warningText"); // and marked
    expect(warningFocusNeeded(e)).toBe(false); // the focus pass stands down entirely
    applyWarningFocus(e, focusRead({})); // even if applied directly, the hold survives
    expect(e.confidence.warningText).toBe(RESCUE_CONTESTED_CONFIDENCE);
  });
});

describe("combineViolationSignals — the TRUE-fails mirror of combineBoldSignals", () => {
  it("asserts the violation only when both agree; a lone violation falls to null", () => {
    expect(combineViolationSignals(true, true)).toBe(true);
    expect(combineViolationSignals(true, null)).toBeNull();
    expect(combineViolationSignals(null, true)).toBeNull();
    expect(combineViolationSignals(true, false)).toBeNull();
    expect(combineViolationSignals(false, null)).toBe(false);
    expect(combineViolationSignals(null, null)).toBeNull();
  });
});

describe("runWarningFocus — two-stage orchestration", () => {
  function focuser(
    reads: (WarningFocusRead | null)[],
    calls: ImageInput[][],
  ): VisionProvider {
    let i = 0;
    return {
      name: "mock",
      extract: () => Promise.reject(new Error("not used")),
      focusWarning: async (images) => {
        calls.push(images);
        return reads[i++] ?? null;
      },
    };
  }

  it("locates on stage 1, crops the carrying image, and re-judges from the crop (stage-2 precedence)", async () => {
    const calls: ImageInput[][] = [];
    const stage1 = focusRead({ imageIndex: 1, prefixBold: null }); // full-image read couldn't tell
    const stage2 = focusRead({ imageIndex: 0, prefixBold: true, box: null });
    const provider = focuser([stage1, stage2], calls);
    const crop = img("crop.png");
    const out = await runWarningFocus(provider, [img("front.png"), img("back.png")], 1000, async (image) => {
      expect(image.filename).toBe("back.png"); // the carrier named by stage 1
      return crop;
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([crop]); // stage 2 sees ONLY the zoomed crop
    expect(out?.prefixBold).toBe(true); // the crop's verdict wins
  });

  it("a CLIPPED stage-2 transcript never replaces the fuller stage-1 read (its flags still win)", async () => {
    const stage1 = focusRead({ prefixBold: null });
    const stage2 = focusRead({ transcript: "GOVERNMENT WARNING: (1) ACCORDING TO", prefixBold: true, box: null });
    const provider = focuser([stage1, stage2], []);
    const out = await runWarningFocus(provider, [img("a.png")], 1000, async () => img("crop.png"));
    expect(out?.transcript).toBe(CANONICAL_GOVERNMENT_WARNING); // fuller stage-1 text kept
    expect(out?.prefixBold).toBe(true); // zoomed flag judgment adopted
  });

  it("falls back to the stage-1 read when the cropper cannot produce a crop", async () => {
    const calls: ImageInput[][] = [];
    const provider = focuser([focusRead({ prefixBold: true })], calls);
    const out = await runWarningFocus(provider, [img("a.png")], 1000, async () => null);
    expect(calls).toHaveLength(1);
    expect(out?.prefixBold).toBe(true);
  });

  it("a not-found stage 1 returns as-is (no crop, no second call)", async () => {
    const calls: ImageInput[][] = [];
    const provider = focuser([focusRead({ found: false, transcript: null })], calls);
    const out = await runWarningFocus(provider, [img("a.png")], 1000, async () => img("never.png"));
    expect(calls).toHaveLength(1);
    expect(out?.found).toBe(false);
  });

  it("a stage-2 failure keeps the stage-1 read (never throws, never loses the locate)", async () => {
    const provider = focuser([focusRead({ prefixBold: true }), null], []);
    const out = await runWarningFocus(provider, [img("a.png")], 1000, async () => img("crop.png"));
    expect(out?.prefixBold).toBe(true);
  });

  it("a hung provider is bounded by the budget and degrades to null", async () => {
    const provider: VisionProvider = {
      name: "mock",
      extract: () => Promise.reject(new Error("not used")),
      focusWarning: () => new Promise(() => {}), // never settles
    };
    const started = Date.now();
    const out = await runWarningFocus(provider, [img("a.png")], 100, async () => null);
    expect(out).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("coerceWarningFocusRead — defensive coercion", () => {
  it("coerces a well-formed payload", () => {
    const read = coerceWarningFocusRead({
      found: true,
      imageIndex: 1,
      transcript: "GOVERNMENT WARNING: ...",
      prefixAllCaps: true,
      prefixBolderThanBody: true,
      remainderBold: false,
      readilyLegible: true,
      rotateClockwiseDegrees: 90,
      box: { left: 0.1, top: 0.2, width: 0.5, height: 0.1 },
    });
    expect(read?.found).toBe(true);
    expect(read?.imageIndex).toBe(1);
    expect(read?.prefixBold).toBe(true);
    expect(read?.rotateClockwise).toBe(90);
    expect(read?.box?.width).toBe(0.5);
  });

  it("folds junk to safe nulls: bad rotation, out-of-range box, non-boolean flags", () => {
    const read = coerceWarningFocusRead({
      found: true,
      imageIndex: -3,
      transcript: "   ",
      prefixAllCaps: "yes",
      prefixBolderThanBody: 1,
      remainderBold: null,
      readilyLegible: undefined,
      rotateClockwiseDegrees: 45,
      box: { left: -0.5, top: 2, width: 0.5, height: 0 },
    });
    expect(read?.imageIndex).toBeNull();
    expect(read?.transcript).toBeNull();
    expect(read?.prefixAllCaps).toBeNull();
    expect(read?.prefixBold).toBeNull();
    expect(read?.rotateClockwise).toBeNull();
    expect(read?.box).toBeNull(); // zero height = no usable region
  });

  it("returns null for a non-object payload", () => {
    expect(coerceWarningFocusRead("nope")).toBeNull();
    expect(coerceWarningFocusRead(null)).toBeNull();
  });
});
