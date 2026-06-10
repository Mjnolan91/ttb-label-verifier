// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { DecisionPanel } from "./DecisionPanel";

afterEach(() => {
  cleanup();
});

/**
 * The decision buttons' selected state: bg-surface and the solid tones (bg-pass-700 / bg-fail-700)
 * have EQUAL CSS specificity, so whichever utility the compiled stylesheet emits last wins — class
 * order in the className string is irrelevant. The selected button must therefore carry ONLY the
 * solid tone background; bg-surface may appear only on the unselected button. (Regression guard for
 * the white-on-white selected button.)
 */
describe("DecisionPanel decision buttons", () => {
  function renderPanel() {
    return render(
      <DecisionPanel verdict="approve" brand="Old Tom Distillery" approveNotes="" rejectNotes="" />,
    );
  }

  test("selected Approve carries the solid pass background and not bg-surface", () => {
    renderPanel();
    const approve = screen.getByRole("button", { name: /approve cola/i });
    fireEvent.click(approve);
    expect(approve.getAttribute("aria-pressed")).toBe("true");
    expect(approve.className).toContain("bg-pass-700");
    expect(approve.className).not.toContain("bg-surface");
  });

  test("selected Reject carries the solid fail background and not bg-surface", () => {
    renderPanel();
    const reject = screen.getByRole("button", { name: /reject \/ send back/i });
    fireEvent.click(reject);
    expect(reject.getAttribute("aria-pressed")).toBe("true");
    expect(reject.className).toContain("bg-fail-700");
    expect(reject.className).not.toContain("bg-surface");
  });

  test("the unselected button keeps the surface background", () => {
    renderPanel();
    const approve = screen.getByRole("button", { name: /approve cola/i });
    const reject = screen.getByRole("button", { name: /reject \/ send back/i });
    fireEvent.click(approve);
    expect(reject.getAttribute("aria-pressed")).toBe("false");
    expect(reject.className).toContain("bg-surface");
  });

  test("rendered copy contains no em dashes (project copy standard)", () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /approve cola/i }));
    expect(container.textContent).not.toContain("—");
  });
});
