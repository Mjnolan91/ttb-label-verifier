/**
 * fieldStyles.ts — shared input/button/card/link class strings (token-based) so the single-label
 * and batch screens stay visually consistent and a11y attributes (44px targets, visible focus ring)
 * are defined once. Transitions are gated by the global prefers-reduced-motion guard in globals.css.
 */
export const inputClass =
  "min-h-[44px] w-full rounded-field border-2 border-border-strong bg-surface px-3 py-2.5 text-ink " +
  "placeholder:text-ink-muted shadow-sm transition focus-visible:outline-none focus-visible:border-brand-600 " +
  "focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

export const primaryButtonClass =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-field bg-brand-600 px-6 text-base " +
  "font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-field border-2 border-brand-600 " +
  "bg-surface px-6 text-base font-semibold text-brand-700 transition hover:bg-brand-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 " +
  "disabled:opacity-50";

export const cardClass = "rounded-card border border-border bg-surface shadow-card";

export const linkClass =
  "font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800 focus-visible:outline-none " +
  "focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";
