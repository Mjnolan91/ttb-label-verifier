// @vitest-environment jsdom
/**
 * ImageLightbox.test.tsx — the accessible zoom overlay (none of this scaffolding existed before).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { ImageLightbox } from "./ImageLightbox";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Enlarge Front label
      </button>
      <ImageLightbox src="/front.png" alt="Front label" open={open} onClose={() => setOpen(false)} />
    </>
  );
}

afterEach(cleanup);

describe("ImageLightbox", () => {
  it("opens to the image, closes on Escape, and returns focus to the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /enlarge front label/i });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: /front label/i });
    expect(within(dialog).getByRole("img", { name: /front label/i })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /close image/i }));

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a backdrop click but not on a click inside the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /enlarge front label/i }));

    const dialog = screen.getByRole("dialog", { name: /front label/i });
    fireEvent.click(within(dialog).getByRole("img", { name: /front label/i }));
    expect(screen.queryByRole("dialog")).not.toBeNull(); // inside click does not close

    fireEvent.click(dialog.parentElement as HTMLElement); // the backdrop
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
