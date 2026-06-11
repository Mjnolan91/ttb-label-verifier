"use client";
/**
 * ImageLightbox — an accessible full-size image overlay. Agents need to read the actual label to
 * trust or override the AI's reading, and a 64px thumbnail can't show a tall bottle label. This is a
 * controlled modal dialog: the parent owns `open` and `onClose`.
 *
 * MULTI-IMAGE: a product is usually front + back (the government warning lives on the back), so the
 * lightbox takes the product's whole image list and lets the reviewer step through it — Previous /
 * Next buttons and arrow keys, with a "1 of 2" position pill. "Confirm it on the label" must never
 * mean "confirm it on the front label only". A single image renders exactly the old, calmer dialog
 * (no navigation chrome).
 *
 * Accessibility:
 *  - role="dialog" + aria-modal, named by the CURRENT image's alt text.
 *  - Escape and a backdrop click close it; a large labelled close button is the first focus.
 *  - Focus is trapped across the dialog's buttons while open and RETURNED to the trigger on close.
 *  - Honors prefers-reduced-motion (fade only under motion-safe).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";

export interface LightboxImage {
  src: string;
  alt: string;
}

export function ImageLightbox({
  images,
  initialIndex = 0,
  open,
  onClose,
}: {
  /** The product's label images, in display order (front first). */
  images: LightboxImage[];
  /** Which image to open on (the clicked thumbnail); navigation moves from there. */
  initialIndex?: number;
  open: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(initialIndex);
  // Resync to the trigger's chosen image whenever the lightbox (re)opens or the trigger changes —
  // the React-sanctioned adjust-state-during-render pattern, no effect.
  const [prev, setPrev] = useState({ open, initialIndex });
  if (open !== prev.open || initialIndex !== prev.initialIndex) {
    setPrev({ open, initialIndex });
    if (open) setIndex(initialIndex);
  }

  // On open: move focus into the dialog, make the rest of the page inert (so the virtual cursor and
  // pointer can't reach background content — aria-modal alone is only a hint), and lock body scroll.
  // On close: restore everything and return focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Inert BOTH the page content and the fixed header controls (theme toggle / help): they sit
    // outside #main-content, so without this they'd stay reachable behind the open dialog.
    // NESTING-SAFE: the batch review drawer opens this lightbox ON TOP of itself, so record whether
    // each attribute was already set and restore the prior state on close — closing the lightbox
    // must not un-inert the page while the drawer underneath is still open.
    const background = [document.getElementById("main-content"), document.getElementById("site-controls")]
      .filter((el): el is HTMLElement => el != null)
      .map((el) => ({ el, hadInert: el.hasAttribute("inert"), hadHidden: el.hasAttribute("aria-hidden") }));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    for (const { el } of background) {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    }
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      for (const { el, hadInert, hadHidden } of background) {
        if (!hadInert) el.removeAttribute("inert");
        if (!hadHidden) el.removeAttribute("aria-hidden");
      }
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const count = images.length;
  const clamped = Math.min(Math.max(0, index), Math.max(0, count - 1));
  const current = images[clamped];
  if (!current) return null;
  const multi = count > 1;
  const step = (delta: number) => setIndex((clamped + delta + count) % count);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (multi && e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (multi && e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Tab") {
      // Trap focus by cycling the dialog's own buttons (close, and prev/next when present).
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      if (buttons.length === 0) return;
      e.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.shiftKey ? (at - 1 + buttons.length) % buttons.length : (at + 1) % buttons.length;
      buttons[next].focus();
    }
  }

  const navButton =
    "inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-xl text-ink shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={current.alt} className="relative flex max-h-full max-w-full">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close image"
          className={`absolute -right-2 -top-2 z-10 ${navButton}`}
        >
          <IconClose />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded object URL, not a static asset */}
        <img
          src={current.src}
          alt={current.alt}
          className="max-h-[85vh] max-w-[90vw] rounded-card bg-white object-contain shadow-card"
        />
        {multi && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous label image"
              className={`absolute -left-2 top-1/2 z-10 -translate-y-1/2 ${navButton}`}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next label image"
              className={`absolute -right-2 top-1/2 z-10 -translate-y-1/2 ${navButton}`}
            >
              <span aria-hidden="true">›</span>
            </button>
            {/* The position pill names the CURRENT image (front vs back matters: the warning lives
                on the back) — a live region so the change is announced as the reviewer steps. */}
            <p
              aria-live="polite"
              className="absolute bottom-2 left-1/2 z-10 max-w-[85%] -translate-x-1/2 truncate rounded-pill bg-black/70 px-3 py-1 text-center text-xs font-semibold text-white"
            >
              {current.alt} · {clamped + 1} of {count}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
