/**
 * warningFocus.ts — the dedicated GOVERNMENT-WARNING escalation: locate → crop/derotate/upscale → re-judge.
 *
 * The warning is the one check that can HARD-FAIL a label, and it fails in two ways the generic
 * pipeline cannot recover from (2026-06-11 RCA, live-measured):
 *   1. MISSING: once the fast reads drop the warning text, nothing re-looks — the rescue pass
 *      excludes ABSENT fields by design, so a single bad read path becomes a final "warning not
 *      found" hard fail.
 *   2. UNVERIFIED FORMAT: on subtle-weight prefixes (condensed all-caps labels) and ROTATED
 *      captures, both the extraction flags and the full-image bold judge honestly answer "cannot
 *      tell" (the judge split SAME/BOLDER on a clean 90-degree render), and verified-means-verified
 *      routes every such label to review, forever.
 *
 * This pass fires ONLY when the warning is required (>=0.5% ABV or unknown) and still missing or
 * unverified after the merge + judge + rescue. ONE bounded strong-model call locates the warning in
 * ANY orientation (stage 1: transcript + 16.22 flags + rotation + bounding box); plain code then
 * CROPS the region, DEROTATES it upright, and UPSCALES it (sharp) so a second bounded call (stage 2)
 * judges the prefix strokes at several times the effective resolution of a full-label photo — the
 * crop-locally-then-ask pattern the vision vendors recommend for fine print.
 *
 * Application is ASYMMETRIC, mirroring the rescue's philosophy:
 *   - A RECOVERED transcript (fast reads saw nothing) surfaces at the review-band confidence, never
 *     a silent pass: the statutory wording lives in every model's training data, so a recovered
 *     canonical text is not self-certifying (hallucination guard).
 *   - An AGREEING transcript (two independent reads) clears the review gate, like the rescue.
 *   - Format flags COMBINE (combineBoldSignals / combineViolationSignals): the focus read can fill
 *     an unverified null with positive evidence, but a lone violation signal from any single source
 *     still lands in review, never a hard fail.
 *
 * The mock provider has no `focusWarning`, so the offline suite and eval never enter this path.
 */
import type { ExtractedFields } from "@/domain";
import { isWarningRequired } from "@/domain";
import { FIELD_REVIEW_CONFIDENCE, parseAlcoholText } from "@/compare";
import { combineBoldSignals, combineViolationSignals } from "./boldJudgment";
import { RESCUE_AGREED_CONFIDENCE, RESCUE_CONTESTED_CONFIDENCE } from "./rescue";
import { DISAGREEMENT_CONFIDENCE, canonical, valuesAgree } from "./reconcile";
import type { ImageInput, VisionProvider, WarningFocusRead } from "./VisionProvider";

/** The dialect-neutral instruction both provider implementations send (cf. RESCUE_PROMPT). */
export const WARNING_FOCUS_PROMPT =
  "You are inspecting U.S. alcohol-beverage label image(s) for the GOVERNMENT HEALTH WARNING " +
  'statement (it begins "GOVERNMENT WARNING:"). You may be shown several images of one product, or ' +
  "a single zoomed crop. The warning may be printed SIDEWAYS (rotated 90 or 270 degrees), UPSIDE " +
  "DOWN, curved, or in very small print — search every region in every orientation before " +
  "concluding it is absent. Report: whether you found it; the 0-based index of the image carrying " +
  "it; its VERBATIM transcript EXACTLY as printed, preserving capitalization and the (1)/(2) " +
  "markers — transcribe ONLY printed text, NEVER reconstruct the well-known statutory wording from " +
  "memory, and omit words you cannot read rather than guessing; whether the \"GOVERNMENT WARNING:\" " +
  "prefix is in all capital letters; whether the prefix's STROKE WEIGHT is heavier than the body " +
  "text after it (bold = thicker/darker strokes, whatever the style; do not penalize italics); " +
  "whether the REMAINDER after the prefix is in bold type; whether the statement is readily " +
  "legible; how many degrees the image must be rotated CLOCKWISE for the warning to read upright " +
  "(0, 90, 180, or 270); and the warning region's bounding box as FRACTIONS (0..1) of the image's " +
  "width and height AS THE IMAGE IS GIVEN to you (its own pixel frame — do NOT mentally derotate " +
  "before measuring the box). Use null for anything you cannot determine — never guess.";

/**
 * Whether a PRESENT warning's text is off-limits to this pass: the CONFLICT band (cross-source
 * contradiction, <= DISAGREEMENT_CONFIDENCE — mirrors rescueEligibleKeys' FP-3 carve-out: a third
 * reading must not arbitrate which panel was right) or a STRONG-READ ADOPTION (the rescue already
 * adopted the strong model's word against the fast majority; the same model re-agreeing with
 * itself is not independent evidence). Both are deliberate review holds a focused re-read must
 * never clear.
 */
function warningTextUntouchable(e: ExtractedFields): boolean {
  if ((e.warningText ?? "").trim() === "") return false;
  const conf = e.confidence.warningText;
  if (typeof conf === "number" && conf <= DISAGREEMENT_CONFIDENCE) return true;
  return e.strongReadAdopted?.includes("warningText") === true;
}

/**
 * Whether the warning still needs focused verification after the merge/judge/rescue: required for
 * this product (>=0.5% ABV at a TRUSTED read, or ABV unknown — conservative) AND missing,
 * low-confidence, or carrying an unverified prefix-format flag (the nulls compareWarning routes to
 * review). Deliberate review holds (conflict band, strong-read adoptions) never trigger — those
 * stay with a human (see warningTextUntouchable).
 */
export function warningFocusNeeded(e: ExtractedFields): boolean {
  const abv = parseAlcoholText(e.alcoholContentText ?? "").abv;
  // Only a TRUSTED sub-0.5% read exempts: a decimal-slip misread ("40%" read as "0.4%") at low
  // confidence must not suppress the very pass built to recover its warning. Over-firing is
  // fail-safe (the asymmetric application can never mint an approval from it).
  const abvTrusted = (e.confidence.alcoholContent ?? 0) >= FIELD_REVIEW_CONFIDENCE;
  if (abv !== undefined && abvTrusted && !isWarningRequired(abv)) return false;
  const text = (e.warningText ?? "").trim();
  if (text === "") return true;
  if (warningTextUntouchable(e)) return false;
  const conf = e.confidence.warningText;
  if (typeof conf !== "number" || conf < FIELD_REVIEW_CONFIDENCE) return true;
  return e.warningPrefixIsAllCaps === null || e.warningPrefixIsBold === null;
}

/**
 * Fold a focus read into the extraction, asymmetrically (see module docs). Mutates and returns `e`.
 */
export function applyWarningFocus(e: ExtractedFields, focus: WarningFocusRead): ExtractedFields {
  // Deliberate review holds (conflict band / strong-read adoptions) are FULLY untouchable — text,
  // confidence, AND flags. The trigger already stands down for them; this is defense in depth so
  // no future caller can agree-boost a held conflict past the gate (adversarial review, blocker).
  if (warningTextUntouchable(e)) return e;
  const strong = (focus.transcript ?? "").trim();
  const found = focus.found && strong !== "";
  if (found) {
    const cur = (e.warningText ?? "").trim();
    if (cur === "") {
      // RECOVERY: surfaced for the reviewer at review-band confidence — a false "missing" hard
      // fail becomes an honest "found on focused re-read, confirm", never a silent pass (the
      // sub-0.7 confidence keeps the field verdict in review regardless of the flags below).
      e.warningText = strong;
      e.confidence.warningText = RESCUE_CONTESTED_CONFIDENCE;
      // The fast reads never saw a warning, so their format flags describe nothing — ADOPT the
      // focus read's judgments, except a lone VIOLATION signal softens to null (one source must
      // never hard-fail; the reviewer sees "could not be verified, confirm" instead).
      e.warningPrefixIsAllCaps = focus.prefixAllCaps === false ? null : focus.prefixAllCaps;
      e.warningPrefixIsBold = focus.prefixBold === false ? null : focus.prefixBold;
      e.warningRemainderIsBold = focus.remainderBold === true ? null : focus.remainderBold;
      e.warningIsReadilyLegible = focus.readilyLegible;
      return e;
    }
    if (valuesAgree(cur, strong)) {
      // Two independent reads agree: keep the fuller form, clear the review gate (rescue semantics).
      if (canonical(strong).length > canonical(cur).length) e.warningText = strong;
      e.confidence.warningText = Math.max(e.confidence.warningText ?? 0, RESCUE_AGREED_CONFIDENCE);
    } else if ((e.confidence.warningText ?? 0) < FIELD_REVIEW_CONFIDENCE) {
      // Cross-read conflict on a CONTESTED read: adopt the focused read as the better suggestion,
      // a human decides (rescue semantics) — and MARK the adoption so nothing downstream can read
      // this model's own words back as independent agreement.
      e.warningText = strong;
      e.confidence.warningText = RESCUE_CONTESTED_CONFIDENCE;
      e.strongReadAdopted = [...new Set([...(e.strongReadAdopted ?? []), "warningText" as const])];
    }
    // Conflict against a CONFIDENT consensus (the trigger was flags-only): the settled multi-sample
    // text stands. A disagreeing focus transcript there is most likely a crop/clipping artifact —
    // live-measured 2026-06-11: a rotated crop's clipped re-read replaced a perfect canonical
    // transcript — so the pass contributes only the format flags below, never a downgrade.
  }
  // Format flags travel WITH a warning: only combine when one is present after the text step, and
  // ONLY from a read that actually FOUND a warning — a found:false read's stray booleans are not a
  // judgment, and "verified" must never rest on a read that claims the warning does not exist.
  if (focus.found && (e.warningText ?? "").trim() !== "") {
    // false hard-fails these two -> combineBoldSignals (a lone "not X" never hard-fails).
    e.warningPrefixIsAllCaps = combineBoldSignals(e.warningPrefixIsAllCaps ?? null, focus.prefixAllCaps);
    e.warningPrefixIsBold = combineBoldSignals(e.warningPrefixIsBold ?? null, focus.prefixBold);
    // TRUE hard-fails the remainder rule -> the mirrored combine (a lone "bold remainder" never hard-fails).
    e.warningRemainderIsBold = combineViolationSignals(e.warningRemainderIsBold ?? null, focus.remainderBold);
    // Legibility false only ever routes to review, so a fill-null is safe; an asserted flag stands.
    e.warningIsReadilyLegible = e.warningIsReadilyLegible ?? focus.readilyLegible;
  }
  return e;
}

/** Crop padding (fraction of the box size on each side) — model boxes are approximate by nature. */
const CROP_PADDING = 0.15;
/** Longest edge of the upscaled crop. High-detail tiling resolves finer strokes on a larger crop. */
const CROP_TARGET_EDGE = 1400;

/** Produces the zoomed, upright crop for stage 2 (null = stage 2 is skipped). Injectable in tests. */
export type WarningCropper = (image: ImageInput, read: WarningFocusRead) => Promise<ImageInput | null>;

/**
 * The default cropper: sharp-backed crop + derotate + upscale. Never throws — any failure
 * (no bytes, degenerate box, sharp unavailable) returns null and the pass proceeds on stage 1 only.
 */
export async function cropWarningRegion(image: ImageInput, read: WarningFocusRead): Promise<ImageInput | null> {
  try {
    if (!image.data || image.data.length === 0 || !read.box) return null;
    const { left, top, width, height } = read.box;
    if (!(width > 0.02) || !(height > 0.01)) return null; // degenerate box
    const rotate =
      read.rotateClockwise === 90 || read.rotateClockwise === 180 || read.rotateClockwise === 270
        ? read.rotateClockwise
        : 0;
    // A near-full-frame box with no rotation would just re-send the original image.
    if (width >= 0.95 && height >= 0.95 && rotate === 0) return null;
    const sharp = (await import("sharp")).default;
    const meta = await sharp(Buffer.from(image.data)).metadata();
    if (!meta.width || !meta.height) return null;
    const l = Math.max(0, left - width * CROP_PADDING);
    const t = Math.max(0, top - height * CROP_PADDING);
    const r = Math.min(1, left + width * (1 + CROP_PADDING));
    const b = Math.min(1, top + height * (1 + CROP_PADDING));
    // Clamp in PIXEL space after rounding: left/width round independently, and on an edge-flush
    // box both can round up so left+width === width+1 — sharp then throws "bad extract area" and
    // the whole zoom stage silently vanished (adversarially caught; full-width warning bands are
    // exactly the edge-flush case).
    const leftPx = Math.min(Math.round(l * meta.width), meta.width - 1);
    const topPx = Math.min(Math.round(t * meta.height), meta.height - 1);
    const region = {
      left: leftPx,
      top: topPx,
      width: Math.min(meta.width - leftPx, Math.max(1, Math.round((r - l) * meta.width))),
      height: Math.min(meta.height - topPx, Math.max(1, Math.round((b - t) * meta.height))),
    };
    if (region.width < 8 || region.height < 8) return null;
    const out = await sharp(Buffer.from(image.data))
      .extract(region)
      .rotate(rotate)
      .resize({ width: CROP_TARGET_EDGE, height: CROP_TARGET_EDGE, fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
    return { filename: `warning-crop-${image.filename}.png`, data: new Uint8Array(out), contentType: "image/png" };
  } catch {
    return null;
  }
}

/** One bounded focus call: on timeout the in-flight request is aborted and the stage degrades to
 *  null (same pattern as readFieldsBounded). Never throws. */
function focusBounded(
  provider: VisionProvider,
  images: ImageInput[],
  timeoutMs: number,
): Promise<WarningFocusRead | null> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    provider
      .focusWarning!(images, ctrl.signal)
      .catch(() => null)
      .finally(() => clearTimeout(timer)),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve(null);
      }, timeoutMs);
    }),
  ]);
}

/** Stage-2 (zoomed-crop) FLAG judgments take precedence — the zoom is what they exist for. The
 *  TRANSCRIPT keeps the FULLER read: a padded model box can clip the warning's edges, and a clipped
 *  crop re-read must never replace a complete stage-1 transcript (live-measured 2026-06-11). */
function mergeFocusReads(s1: WarningFocusRead, s2: WarningFocusRead | null): WarningFocusRead {
  if (!s2 || !s2.found) return s1;
  const t1 = (s1.transcript ?? "").trim();
  const t2 = (s2.transcript ?? "").trim();
  return {
    found: true,
    imageIndex: s1.imageIndex,
    transcript: canonical(t2).length > canonical(t1).length ? s2.transcript : s1.transcript,
    prefixAllCaps: s2.prefixAllCaps ?? s1.prefixAllCaps,
    prefixBold: s2.prefixBold ?? s1.prefixBold,
    remainderBold: s2.remainderBold ?? s1.remainderBold,
    readilyLegible: s2.readilyLegible ?? s1.readilyLegible,
    rotateClockwise: s1.rotateClockwise,
    box: s1.box,
  };
}

/**
 * Run the two-stage focus pass (each stage bounded by `timeoutMs`): locate across all images, then
 * re-judge from the zoomed upright crop when one can be produced. Returns the merged read, or null
 * when stage 1 failed/timed out — never throws (a failed pass leaves the extraction untouched).
 */
export async function runWarningFocus(
  provider: VisionProvider,
  images: ImageInput[],
  timeoutMs: number,
  cropper: WarningCropper = cropWarningRegion,
): Promise<WarningFocusRead | null> {
  const stage1 = await focusBounded(provider, images, timeoutMs);
  if (!stage1 || !stage1.found) return stage1;
  const idx = stage1.imageIndex;
  const carrier = idx !== null && idx >= 0 && idx < images.length ? images[idx] : undefined;
  if (!carrier) return stage1;
  const crop = await cropper(carrier, stage1);
  if (!crop) return stage1;
  const stage2 = await focusBounded(provider, [crop], timeoutMs);
  return mergeFocusReads(stage1, stage2);
}

/**
 * Coerce a model's parsed focus JSON into a WarningFocusRead (shared by both provider dialects).
 * Defensive: wrong types fold to null, the box is clamped to sane fractions, rotation snaps to a
 * quarter turn. Returns null for a payload that isn't an object.
 */
export function coerceWarningFocusRead(parsed: unknown): WarningFocusRead | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  const flag = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const rotRaw = num(p.rotateClockwiseDegrees);
  const rotateClockwise = rotRaw === 0 || rotRaw === 90 || rotRaw === 180 || rotRaw === 270 ? rotRaw : null;
  let box: WarningFocusRead["box"] = null;
  if (typeof p.box === "object" && p.box !== null) {
    const b = p.box as Record<string, unknown>;
    const left = num(b.left);
    const top = num(b.top);
    const width = num(b.width);
    const height = num(b.height);
    if (left !== null && top !== null && width !== null && height !== null && width > 0 && height > 0) {
      const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
      box = {
        left: clamp01(left),
        top: clamp01(top),
        width: Math.min(1, Math.max(0, width)),
        height: Math.min(1, Math.max(0, height)),
      };
    }
  }
  const imageIndexRaw = num(p.imageIndex);
  return {
    found: p.found === true,
    imageIndex: imageIndexRaw !== null && imageIndexRaw >= 0 ? Math.floor(imageIndexRaw) : null,
    transcript: typeof p.transcript === "string" && p.transcript.trim() !== "" ? p.transcript : null,
    prefixAllCaps: flag(p.prefixAllCaps),
    prefixBold: flag(p.prefixBolderThanBody),
    remainderBold: flag(p.remainderBold),
    readilyLegible: flag(p.readilyLegible),
    rotateClockwise,
    box,
  };
}
