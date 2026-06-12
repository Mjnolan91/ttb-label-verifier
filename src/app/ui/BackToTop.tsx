"use client";

/**
 * BackToTop — the floating return control for the two long screens (the verify flow's application
 * grid + results, the batch worklist). Appears only past ~1.75 viewports of scroll: the deep
 * stretch the progress pill's spine-jump doesn't serve (a control that is always there is chrome;
 * one that arrives when needed is help), and the reveal carries hysteresis (hide back under ~1.25)
 * so a trackpad resting at the boundary never flickers it. Bottom-right: the one corner no fixed
 * element owns (progress pill top-left, header controls top-right).
 *
 * The jump is smooth only when motion is allowed and the page is visible (the jumpToSpine
 * convention), and it moves focus to #main-content (the skip-link target, tabIndex={-1} on both
 * pages) so keyboard and screen-reader users land where they visually went instead of stranding
 * focus at the bottom.
 *
 * Render it INSIDE each page's <main>: it positions fixed regardless, and living in #main-content
 * means the modal inert contract (Drawer / ImageLightbox) covers it for free.
 */
import { useEffect, useState } from "react";
import { IconArrowUp } from "./icons";

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      if (raf) return; // coalesce scroll/resize bursts to one read per frame
      raf = requestAnimationFrame(() => {
        raf = 0;
        setVisible((prev) =>
          prev ? window.scrollY > window.innerHeight * 1.25 : window.scrollY > window.innerHeight * 1.75,
        );
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update); // an orientation change can cross the threshold without a scroll
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  if (!visible) return null;

  function jump() {
    const reduceMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const smoothOk = !reduceMotion && document.visibilityState !== "hidden";
    window.scrollTo({ top: 0, behavior: smoothOk ? "smooth" : "auto" });
    const main = document.getElementById("main-content");
    // preventScroll: the smooth scroll above owns the movement; a focus jump would fight it.
    if (main instanceof HTMLElement) main.focus({ preventScroll: true });
  }

  return (
    <button
      type="button"
      onClick={jump}
      aria-label="Back to top"
      className="fixed bottom-4 right-3 z-40 inline-flex min-h-[44px] items-center gap-2 rounded-pill border border-border bg-surface/95 px-4 text-sm font-semibold text-ink shadow-card backdrop-blur transition hover:border-brand-600 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 motion-safe:animate-reveal sm:bottom-5 sm:right-4"
    >
      <IconArrowUp className="h-5 w-5" />
      <span className="hidden sm:inline">Top</span>
    </button>
  );
}
