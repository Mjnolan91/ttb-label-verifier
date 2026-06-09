/**
 * status.tsx — the one place status maps to a visual "tone". Keeps color + icon locked together so
 * a status is NEVER conveyed by color alone (WCAG 1.4.1): callers always render the tone's icon AND
 * a text label. Tints/badges use the verified token pairings (dark-on-tint >=4.5:1; white-on-700
 * >=4.5:1).
 */
import type { ComponentType } from "react";
import { IconPass, IconReview, IconFail, IconPhoto, type IconProps } from "./icons";

/**
 * Tones, each with ONE meaning so the palette stays semantically clean:
 *  - pass    = matched / complete (green)
 *  - verify  = the values MATCHED, we just want a human to glance at a fuzzy photo (calm blue) — NOT
 *              an alarm; categorically different from a real discrepancy
 *  - review  = a genuine discrepancy a person must reconcile (amber/alarm)
 *  - fail    = a hard mismatch / missing required element (red)
 *  - neutral = not applicable / no signal (slate)
 */
export type Tone = "pass" | "verify" | "review" | "fail" | "neutral";

/**
 * Human-facing labels for the overall outcomes — the SINGLE source so the single-label screen and
 * the batch table read identically (no raw "approve"/"incomplete" enum tokens leaking to the user).
 */
export const VERDICT_LABEL: Record<"approve" | "review" | "reject", string> = {
  approve: "Approve",
  review: "Needs review",
  reject: "Reject",
};
export const COMPLETENESS_LABEL: Record<"complete" | "incomplete" | "review", string> = {
  complete: "Complete",
  incomplete: "Incomplete",
  review: "Needs review",
};
/**
 * Per-field comparison labels for the claimed-vs-label cards. Plain language that mirrors the overall
 * verdict's vocabulary (Approve / Needs review / Reject) so the same screen never shows the headline
 * in words and the field cards in raw enum tokens (PASS/REVIEW/FAIL).
 */
export const FIELD_LABEL: Record<"pass" | "review" | "fail", string> = {
  pass: "Match",
  review: "Needs review",
  fail: "No match",
};
/** Badge label for a field that MATCHED on value but is held for a low-confidence (fuzzy) photo read —
 *  deliberately distinct from "Needs review" so a match never wears the same words as a discrepancy. */
export const GATED_MATCH_LABEL = "Match · confirm photo";

/** Map any per-field or overall status string to a tone. Unknowns ("…", "—", "pending") -> neutral. */
export function toneForStatus(value: string): Tone {
  switch (value) {
    case "pass":
    case "approve":
      return "pass";
    case "review":
    case "re-upload":
      return "review";
    case "fail":
    case "reject":
      return "fail";
    default:
      return "neutral";
  }
}

/** Tinted surface for cards/banners: border accent + light bg + dark readable text. */
export const TONE_TINT: Record<Tone, string> = {
  pass: "border-pass-600 bg-pass-50 text-pass-900",
  verify: "border-brand-500 bg-brand-50 text-brand-800",
  review: "border-review-500 bg-review-50 text-review-900",
  fail: "border-fail-600 bg-fail-50 text-fail-900",
  neutral: "border-border bg-surface-sunken text-ink-muted",
};

/** Solid pill: white text on the -700 status color (or muted ink for neutral). */
export const TONE_SOLID: Record<Tone, string> = {
  pass: "bg-pass-700 text-white",
  verify: "bg-brand-600 text-white",
  review: "bg-review-700 text-white",
  fail: "bg-fail-700 text-white",
  neutral: "bg-ink-muted text-white",
};

export const TONE_ICON: Record<Tone, ComponentType<IconProps> | null> = {
  pass: IconPass,
  verify: IconPhoto,
  review: IconReview,
  fail: IconFail,
  neutral: null,
};

/**
 * The solid tone color as a CSS variable, for the "lit" verdict bubble: a filled icon disc (white icon
 * reads on each) and a soft same-color glow. Uses the -700/-600 shades so white-on-color stays legible.
 */
export const TONE_SOLID_VAR: Record<Tone, string> = {
  pass: "var(--color-pass-700)",
  verify: "var(--color-brand-600)",
  review: "var(--color-review-700)",
  fail: "var(--color-fail-700)",
  neutral: "var(--color-ink-muted)",
};
