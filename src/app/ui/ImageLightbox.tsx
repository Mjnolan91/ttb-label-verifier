"use client";
/**
 * ImageLightbox — an accessible full-size image overlay. Agents need to read the actual label to
 * trust or override the AI's reading, and a 64px thumbnail can't show a tall bottle label. This is a
 * controlled modal dialog: the parent owns `open` and `onClose`.
 *
 * Accessibility (none of this existed before — the old thumbnail was a bare <img>):
 *  - role="dialog" + aria-modal, named by the image's alt text.
 *  - Escape and a backdrop click close it; a large labelled close button is the first focus.
 *  - Focus is trapped inside while open and RETURNED to the trigger on close.
 *  - Honors prefers-reduced-motion (fade only under motion-safe).
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";

export function ImageLightbox({
  src,
  alt,
  open,
  onClose,
}: {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog on open and restore it to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      // Only the close button is focusable, so trap by keeping focus on it.
      e.preventDefault();
      closeRef.current?.focus();
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div role="dialog" aria-modal="true" aria-label={alt} className="relative flex max-h-full max-w-full">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close image"
          className="absolute -right-2 -top-2 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-xl text-ink shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          <IconClose />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element -- user-uploaded object URL, not a static asset */}
        <img
          src={src}
          alt={alt}
          className="max-h-[85vh] max-w-[90vw] rounded-card bg-white object-contain shadow-card"
        />
      </div>
    </div>,
    document.body,
  );
}
