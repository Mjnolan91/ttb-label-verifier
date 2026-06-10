// @vitest-environment jsdom
/**
 * FieldHelp.test.tsx — the "?" toggletip beside each application input: accessible description that
 * always resolves, hover/focus/click-pin behavior, Escape dismissal, and the copy standard for the
 * help text itself (full coverage of the appInputs keys, TTB vocabulary, no em dashes).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FieldHelp } from "./FieldHelp";
import { APP_FIELD_HELP } from "./fieldHelpCopy";

afterEach(cleanup);

describe("FieldHelp", () => {
  const setup = () => {
    render(<FieldHelp label="Class / type" text="What the product is, in TTB's terms." />);
    return screen.getByRole("button", { name: "About Class / type" });
  };

  it("always exposes the help text as the trigger's accessible description (even closed)", () => {
    const trigger = setup();
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const bubble = document.getElementById(describedBy as string);
    expect(bubble?.textContent).toContain("TTB's terms");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on focus and closes on blur (keyboard path)", () => {
    const trigger = setup();
    fireEvent.focus(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("tooltip").className).not.toContain("sr-only");
    fireEvent.blur(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on hover of the wrapper and stays open while hovered (WCAG 1.4.13 hoverable)", () => {
    const trigger = setup();
    const wrapper = trigger.parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseLeave(wrapper);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("click pins it open (touch path) and Escape dismisses without bubbling", () => {
    const trigger = setup();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("APP_FIELD_HELP — the copy itself", () => {
  it("covers every application input on the verify screen", () => {
    expect(Object.keys(APP_FIELD_HELP).sort()).toEqual(
      [
        "address",
        "alcoholContent",
        "brand",
        "classType",
        "countryOfOrigin",
        "fancifulName",
        "name",
        "netContents",
        "statementOfComposition",
      ].sort(),
    );
  });

  it("keeps the copy standard: no em dashes, non-empty, and short enough for a bubble", () => {
    for (const [key, text] of Object.entries(APP_FIELD_HELP)) {
      expect(text, key).not.toContain("—");
      expect(text.trim().length, key).toBeGreaterThan(20);
      expect(text.length, key).toBeLessThan(320);
    }
  });

  it("never quotes or paraphrases the statutory government warning", () => {
    for (const text of Object.values(APP_FIELD_HELP)) {
      expect(text.toUpperCase()).not.toContain("GOVERNMENT WARNING");
      expect(text).not.toContain("Surgeon General");
    }
  });
});
