// @vitest-environment jsdom
/**
 * BackToTop.test.tsx — the floating return control: hidden until ~1.75 viewports scroll past,
 * hysteresis on the way back (hides only under ~1.25), recomputes on resize, jumps to the top
 * (smooth under motion-safe, instant under reduced motion), and moves focus to the #main-content
 * skip-link target so keyboard/AT users land where they visually went.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BackToTop } from "./BackToTop";

function setScroll(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  fireEvent.scroll(window);
}
function setViewportHeight(h: number) {
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
  fireEvent.resize(window);
}

beforeEach(() => {
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BackToTop", () => {
  it("is hidden at the top, appears past ~1.75 viewports, and hides again at the top", async () => {
    render(<BackToTop />);
    expect(screen.queryByRole("button", { name: /back to top/i })).toBeNull();

    setScroll(1500); // > 800 * 1.75
    await screen.findByRole("button", { name: /back to top/i });

    setScroll(0);
    await waitFor(() => expect(screen.queryByRole("button", { name: /back to top/i })).toBeNull());
  });

  it("holds steady between the show and hide thresholds (hysteresis, no flicker)", async () => {
    render(<BackToTop />);
    setScroll(1100); // between 1.25 and 1.75 viewports while hidden -> stays hidden
    await waitFor(() => expect(window.scrollY).toBe(1100));
    expect(screen.queryByRole("button", { name: /back to top/i })).toBeNull();

    setScroll(1500);
    await screen.findByRole("button", { name: /back to top/i });
    setScroll(1100); // same band while visible -> stays visible
    await waitFor(() => expect(window.scrollY).toBe(1100));
    expect(screen.queryByRole("button", { name: /back to top/i })).toBeTruthy();
  });

  it("recomputes on resize (an orientation change can cross the threshold without a scroll)", async () => {
    render(<BackToTop />);
    setScroll(1500);
    await screen.findByRole("button", { name: /back to top/i });

    setViewportHeight(1400); // 1500 < 1400 * 1.25 -> hides without any scroll event
    await waitFor(() => expect(screen.queryByRole("button", { name: /back to top/i })).toBeNull());
  });

  it("scrolls smoothly to the top and moves focus to #main-content", async () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.appendChild(main);
    try {
      render(<BackToTop />);
      setScroll(1500);
      fireEvent.click(await screen.findByRole("button", { name: /back to top/i }));
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
      expect(document.activeElement).toBe(main);
    } finally {
      main.remove();
    }
  });

  it("jumps instantly under prefers-reduced-motion", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<BackToTop />);
    setScroll(1500);
    fireEvent.click(await screen.findByRole("button", { name: /back to top/i }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });

  it("renders no em dashes (project copy standard)", async () => {
    render(<BackToTop />);
    setScroll(1500);
    const btn = await screen.findByRole("button", { name: /back to top/i });
    expect(btn.textContent).not.toContain("—");
  });
});
