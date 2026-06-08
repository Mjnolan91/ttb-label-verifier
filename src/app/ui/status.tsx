/**
 * status.tsx — the one place status maps to a visual "tone". Keeps color + icon locked together so
 * a status is NEVER conveyed by color alone (WCAG 1.4.1): callers always render the tone's icon AND
 * a text label. Tints/badges use the verified token pairings (dark-on-tint >=4.5:1; white-on-700
 * >=4.5:1).
 */
import type { ComponentType } from "react";
import { IconPass, IconReview, IconFail, type IconProps } from "./icons";

export type Tone = "pass" | "review" | "fail" | "neutral";

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
  review: "border-review-500 bg-review-50 text-review-900",
  fail: "border-fail-600 bg-fail-50 text-fail-900",
  neutral: "border-border bg-surface-sunken text-ink-muted",
};

/** Solid pill: white text on the -700 status color (or muted ink for neutral). */
export const TONE_SOLID: Record<Tone, string> = {
  pass: "bg-pass-700 text-white",
  review: "bg-review-700 text-white",
  fail: "bg-fail-700 text-white",
  neutral: "bg-ink-muted text-white",
};

export const TONE_ICON: Record<Tone, ComponentType<IconProps> | null> = {
  pass: IconPass,
  review: IconReview,
  fail: IconFail,
  neutral: null,
};
