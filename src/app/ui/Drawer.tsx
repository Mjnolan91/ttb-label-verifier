"use client";
/**
 * Drawer — an accessible right-side slide-over dialog, used to open one product's full review beside the
 * batch worklist. Mirrors ImageLightbox's modal a11y (role="dialog" + aria-modal, the rest of the page
 * made inert, body scroll locked, focus moved in and returned on close, Escape + backdrop close), but
 * holds arbitrary children and traps Tab across all the focusable controls inside.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

export function Drawer({
  open,
  onClose,
  title,
  children,
  closeLabel = "Close review",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Accessible name for the close button ("Close review" suits the batch drawer; override elsewhere). */
  closeLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Inert BOTH the page content and the fixed header controls (theme toggle / help): they sit
    // outside #main-content, so without this they'd stay reachable behind the open dialog.
    // NESTING-SAFE: modals can stack (the batch review drawer opens an ImageLightbox), so each
    // records whether it SET the attributes and the cleanup restores the prior state instead of
    // blindly removing them — an inner modal closing must not un-inert the page under an outer one.
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

  if (!open || typeof document === "undefined") return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full max-w-2xl flex-col bg-surface shadow-2xl motion-safe:animate-reveal"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-4">
          <h2 className="truncate text-lg font-semibold text-ink">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-xl text-ink transition hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            <IconClose />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
