"use client";

/**
 * ThemeToggle — flips light/dark and remembers the choice in localStorage. The `.dark` class is applied
 * to <html> before paint by the inline script in layout.tsx (so there's no flash); this control just
 * toggles it and persists the preference. First-visit default is LIGHT (the script applies dark only
 * when this control explicitly chose it; prefers-color-scheme is deliberately not consulted).
 *
 * The current theme is read from the DOM with useSyncExternalStore: the server snapshot is "light" so
 * hydration matches the SSR output, then the client reflects the real (pre-paint) class — no
 * setState-in-effect, no hydration mismatch. A MutationObserver re-renders the icon when the class flips.
 */
import { useSyncExternalStore } from "react";
import { IconSun, IconMoon } from "./icons";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isDarkNow = () => document.documentElement.classList.contains("dark");
const isDarkServer = () => false;

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDarkNow, isDarkServer);

  function toggle() {
    const next = !dark;
    const el = document.documentElement;
    // Ease the colors between themes (300ms), then drop the class so nothing else transitions.
    el.classList.add("theme-transition");
    el.classList.toggle("dark", next); // the observer re-renders this control
    window.setTimeout(() => el.classList.remove("theme-transition"), 360);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* private mode / storage disabled, the toggle still works for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex min-h-[40px] items-center gap-2 rounded-field border border-border bg-surface px-3 text-sm font-semibold text-ink shadow-sm transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
    >
      {dark ? <IconSun className="h-5 w-5" /> : <IconMoon className="h-5 w-5" />}
      <span className="hidden sm:inline">{dark ? "Light" : "Dark"}</span>
    </button>
  );
}
