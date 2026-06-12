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

  it("keyboard focus on a populated field parks the caret at the END, ready to edit", () => {
    // A textarea drops Tab-focus at position 0 (unlike an <input>); editing continues at the end.
    const { field } = renderField({ value: "750 ML" });
    field.setSelectionRange(0, 0); // pin the (0,0) caret a browser Tab-landing produces
    fireEvent.focus(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([6, 6]);
  });

  it("focus never disturbs an existing caret position (a click's placement wins)", () => {
    const { field } = renderField({ value: "750 ML" });
    field.setSelectionRange(3, 3); // as if the user clicked mid-value
    fireEvent.focus(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([3, 3]);
  });
});
