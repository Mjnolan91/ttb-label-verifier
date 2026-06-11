// @vitest-environment jsdom
/**
 * ImageLightbox.test.tsx — the accessible zoom overlay, including the multi-image navigation
 * (a product is usually front + back, and "confirm it on the label" must never mean front-only).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { ImageLightbox, type LightboxImage } from "./ImageLightbox";

const FRONT: LightboxImage = { src: "/front.png", alt: "Front label" };
const BACK: LightboxImage = { src: "/back.png", alt: "Back label" };

function Harness({ images, initialIndex = 0 }: { images: LightboxImage[]; initialIndex?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Enlarge Front label
      </button>
      <ImageLightbox images={images} initialIndex={initialIndex} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

afterEach(cleanup);

describe("ImageLightbox", () => {
  it("opens to the image, closes on Escape, and returns focus to the trigger", () => {
    render(<Harness images={[FRONT]} />);
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

  it("locks body scroll while open and restores it on close", () => {
    render(<Harness images={[FRONT]} />);
    expect(document.body.style.overflow).not.toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: /enlarge front label/i }));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(screen.getByRole("dialog", { name: /front label/i }), { key: "Escape" });
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("closes on a backdrop click but not on a click inside the dialog", () => {
    render(<Harness images={[FRONT]} />);
    fireEvent.click(screen.getByRole("button", { name: /enlarge front label/i }));

    const dialog = screen.getByRole("dialog", { name: /front label/i });
    fireEvent.click(within(dialog).getByRole("img", { name: /front label/i }));
    expect(screen.queryByRole("dialog")).not.toBeNull(); // inside click does not close

    fireEvent.click(dialog.parentElement as HTMLElement); // the backdrop
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a single image shows NO navigation chrome (the calm old dialog)", () => {
    render(<Harness images={[FRONT]} />);
    fireEvent.click(screen.getByRole("button", { name: /enlarge front label/i }));
    expect(screen.queryByRole("button", { name: /next label image/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /previous label image/i })).toBeNull();
    expect(screen.queryByText(/1 of 1/)).toBeNull();
  });

  it("steps front -> back with the Next button and arrow keys, naming the current image", () => {
    render(<Harness images={[FRONT, BACK]} />);
    fireEvent.click(screen.getByRole("button", { name: /enlarge front label/i }));

    // Opens at the front with the position pill.
    let dialog = screen.getByRole("dialog", { name: /front label/i });
    expect(screen.getByText(/Front label · 1 of 2/)).toBeTruthy();

    // Next button -> the back label (dialog renames to the current image).
    fireEvent.click(within(dialog).getByRole("button", { name: /next label image/i }));
    dialog = screen.getByRole("dialog", { name: /back label/i });
    expect(within(dialog).getByRole("img", { name: /back label/i })).toBeTruthy();
    expect(screen.getByText(/Back label · 2 of 2/)).toBeTruthy();

    // ArrowRight wraps back around to the front.
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: /front label/i })).toBeTruthy();

    // ArrowLeft wraps to the back again.
    fireEvent.keyDown(screen.getByRole("dialog", { name: /front label/i }), { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: /back label/i })).toBeTruthy();
  });

  it("opens at the CLICKED image when initialIndex names it", () => {
    render(<Harness images={[FRONT, BACK]} initialIndex={1} />);
    fireEvent.click(screen.getByRole("button", { name: /enlarge front label/i }));
    expect(screen.getByRole("dialog", { name: /back label/i })).toBeTruthy();
    expect(screen.getByText(/Back label · 2 of 2/)).toBeTruthy();
  });

  it("Tab cycles every dialog button (close, previous, next) without escaping the trap", () => {
    render(<Harness images={[FRONT, BACK]} />);
    fireEvent.click(screen.getByRole("button", { name: /enlarge front label/i }));
    const dialog = screen.getByRole("dialog", { name: /front label/i });
    const close = within(dialog).getByRole("button", { name: /close image/i });
    const prev = within(dialog).getByRole("button", { name: /previous label image/i });
    const next = within(dialog).getByRole("button", { name: /next label image/i });

    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(prev);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close); // wrapped
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(next); // and backwards
  });
});
