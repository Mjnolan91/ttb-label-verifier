// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
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

/**
 * Focus follows the flow: the email composer mounts below the fold in the batch drawer, so each
 * state change must MOVE focus to what just appeared - choosing a decision lands on the composer
 * (the reviewer can never miss the applicant email), recording lands on the confirmation, and
 * "Change decision" returns to the decision buttons.
 */
describe("DecisionPanel focus management", () => {
  function renderPanel() {
    return render(
      <DecisionPanel
        verdict="approve"
        brand="Old Tom Distillery"
        approveNotes=""
        rejectNotes=""
        onRecord={() => {}}
      />,
    );
  }

  test("choosing a decision moves focus to the email composer", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /approve cola/i }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("group", { name: /email to the applicant/i })),
    );
  });

  test("recording the decision moves focus to the confirmation banner", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /approve cola/i }));
    fireEvent.click(screen.getByRole("button", { name: /record decision & send email/i }));
    const recorded = screen.getByRole("status");
    expect(recorded.textContent).toContain("Recorded: Approved");
    await waitFor(() => expect(document.activeElement).toBe(recorded));
  });

  test("'Change decision' returns focus to the decision buttons", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /approve cola/i }));
    fireEvent.click(screen.getByRole("button", { name: /record decision & send email/i }));
    fireEvent.click(screen.getByRole("button", { name: /change decision/i }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("group", { name: /^decision$/i })));
  });

  test("the recorded confirmation offers 'Start the next label' only when wired, and it fires the callback", () => {
    const onStartNext = vi.fn();
    render(
      <DecisionPanel
        verdict="approve"
        brand="Old Tom Distillery"
        approveNotes=""
        rejectNotes=""
        onRecord={() => {}}
        onStartNext={onStartNext}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve cola/i }));
    fireEvent.click(screen.getByRole("button", { name: /record decision & send email/i }));
    fireEvent.click(screen.getByRole("button", { name: /start the next label/i }));
    expect(onStartNext).toHaveBeenCalledTimes(1);

    cleanup();
    renderPanel(); // no onStartNext prop
    fireEvent.click(screen.getByRole("button", { name: /approve cola/i }));
    fireEvent.click(screen.getByRole("button", { name: /record decision & send email/i }));
    expect(screen.queryByRole("button", { name: /start the next label/i })).toBeNull();
  });

  test("RE-CLICKING the already-resumed decision still brings up the composer (React bails out of the render)", async () => {
    // A worklist re-review resumes with initialDecision set; clicking the same decision changes no
    // state, so a render-driven focus would never fire. The frame-scheduled focus must still run.
    render(
      <DecisionPanel
        verdict="approve"
        brand="Old Tom Distillery"
        approveNotes=""
        rejectNotes=""
        onRecord={() => {}}
        initialDecision="approve"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve cola/i }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("group", { name: /email to the applicant/i })),
    );
  });
});
