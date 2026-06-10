"use client";

/**
 * FieldHelp — a small "?" toggletip beside an application input's label, explaining the TTB term in
 * plain language. Zero dependencies, follows the WAI-ARIA tooltip pattern with a click-pin hybrid so
 * it works for hover, keyboard, and touch (WCAG 1.4.13: hoverable, dismissible, persistent):
 *
 *  - Hover or focus shows the bubble; moving the pointer ONTO the bubble keeps it open (the hover
 *    handlers live on a wrapper spanning trigger + bubble).
 *  - Click toggles a PIN (touch support: tap opens, tap again closes); Escape always dismisses.
 *  - The bubble stays in the DOM when closed (sr-only), so the trigger's aria-describedby always
 *    resolves for screen readers; there is no auto-hide timer.
 *
 * IMPORTANT for callers: render this as a SIBLING of the <label>, never inside it. Inside a label, a
 * click would focus the labelled input and the help text would pollute the input's accessible name.
 * The open bubble is absolutely positioned against the nearest positioned ancestor and spans its
 * width, so wrap each field in a `relative` container; anchoring to the tiny trigger instead would
 * overflow the viewport on narrow screens.
 */
import { useId, useState, type KeyboardEvent } from "react";
import { IconHelp } from "./icons";

export function FieldHelp({ label, text }: { label: string; text: string }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || focused || pinned;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation(); // dismiss only the bubble, not an enclosing dialog
      setHovered(false);
      setFocused(false);
      setPinned(false);
    }
  }

  return (
    <span
      className="inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-muted transition hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-1"
      >
        <IconHelp className="h-4 w-4" />
      </button>
      <span
        id={id}
        role="tooltip"
        className={
          open
            ? "absolute inset-x-0 top-full z-20 mt-1.5 rounded-field border border-border bg-surface p-2.5 text-xs font-normal leading-relaxed text-ink shadow-card"
            : "sr-only"
        }
      >
        {text}
      </span>
    </span>
  );
}
