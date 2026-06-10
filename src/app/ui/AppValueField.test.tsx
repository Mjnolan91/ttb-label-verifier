// @vitest-environment jsdom
/**
 * AppValueField.test.tsx — the wrap-instead-of-clip application value control.
 * Locks the single-logical-line contract: Enter never inserts a newline, pasted newlines collapse
 * to spaces, and the grey suggestion renders as a real placeholder (the batch-drawer regression).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppValueField } from "./AppValueField";

afterEach(cleanup);

function renderField(props: Partial<Parameters<typeof AppValueField>[0]> = {}) {
  const onValueChange = vi.fn();
  render(
    <>
      <label htmlFor="f">Brand name</label>
      <AppValueField id="f" value="" onValueChange={onValueChange} className="x" {...props} />
    </>,
  );
  return { field: screen.getByLabelText("Brand name") as HTMLTextAreaElement, onValueChange };
}

describe("AppValueField", () => {
  it("renders the suggestion as a real placeholder (grey example in the box)", () => {
    const { field } = renderField({ placeholder: "Old Tom Distillery" });
    expect(field.placeholder).toBe("Old Tom Distillery");
  });

  it("collapses pasted newlines to spaces (values are single logical lines)", () => {
    const { onValueChange } = renderField();
    fireEvent.change(screen.getByLabelText("Brand name"), {
      target: { value: "Sailor Sally's Cellars,\nValencia, Spain" },
    });
    expect(onValueChange).toHaveBeenCalledWith("Sailor Sally's Cellars, Valencia, Spain");
  });

  it("Enter is prevented (no newline growth) and the caller's onKeyDown still runs", () => {
    const onKeyDown = vi.fn();
    const { field } = renderField({ onKeyDown });
    const enter = fireEvent.keyDown(field, { key: "Enter" });
    expect(enter).toBe(false); // preventDefault was called
    expect(onKeyDown).toHaveBeenCalled();
  });
});
