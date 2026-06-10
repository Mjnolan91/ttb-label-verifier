// @vitest-environment jsdom
/**
 * HelpButton.test.tsx — the header "?" help panel: opens an accessible dialog with the usage script
 * (verdict meanings + the three sample labels), closes on Escape with focus returned, and keeps the
 * project copy standard (no em dashes in rendered text).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HelpButton } from "./HelpButton";

afterEach(cleanup);

describe("HelpButton", () => {
  it("opens the help dialog, names it, and closes on Escape with focus returned to the trigger", () => {
    render(<HelpButton />);
    const trigger = screen.getByRole("button", { name: /help/i });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: /help/i });
    // The close button carries its own accessible name (not the batch drawer's "Close review").
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: /close help/i }));

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("explains the three verdicts and links all three sample labels as downloads", () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    const dialog = within(screen.getByRole("dialog", { name: /help/i }));

    for (const verdict of ["Approve.", "Needs review.", "Reject."]) {
      expect(dialog.getByText(verdict)).toBeTruthy();
    }
    for (const name of [/clean bourbon/i, /title-case warning/i, /brand typo/i]) {
      const link = dialog.getByRole("link", { name }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toMatch(/^\/samples\/demo-/);
      expect(link.hasAttribute("download")).toBe(true);
    }
    expect(dialog.getByRole("link", { name: /batch screen/i })).toBeTruthy();
  });

  it("renders no em dashes (project copy standard)", () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    const dialog = screen.getByRole("dialog", { name: /help/i });
    expect(dialog.textContent).not.toContain("—");
  });

  it("inerts the page content and the header controls while open, and restores them on close", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    document.body.appendChild(main);
    const controls = document.createElement("div");
    controls.id = "site-controls";
    document.body.appendChild(controls);
    try {
      render(<HelpButton />);
      fireEvent.click(screen.getByRole("button", { name: /help/i }));
      expect(main.hasAttribute("inert")).toBe(true);
      expect(controls.hasAttribute("inert")).toBe(true);
      fireEvent.keyDown(screen.getByRole("dialog", { name: /help/i }), { key: "Escape" });
      expect(main.hasAttribute("inert")).toBe(false);
      expect(controls.hasAttribute("inert")).toBe(false);
    } finally {
      main.remove();
      controls.remove();
    }
  });
});
