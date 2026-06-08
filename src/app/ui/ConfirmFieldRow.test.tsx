// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ConfirmFieldRow } from "./ConfirmFieldRow";
import type { ConfirmFieldResult } from "@/compare";

afterEach(cleanup);

const field = (o: Partial<ConfirmFieldResult> = {}): ConfirmFieldResult => ({
  key: "brand", label: "Brand name", necessity: "mandatory",
  aiValue: "Old Tom Distillery", value: "Old Tom Distillery", confidence: 0.4,
  editable: true, flagged: true, needsConfirmation: true, state: "unconfirmed",
  status: "review", reason: "The AI wasn't fully sure.", ...o,
});

describe("ConfirmFieldRow", () => {
  it("the ✓ Confirm button accepts the field", () => {
    const onAccept = vi.fn();
    const q = within(render(
      <ConfirmFieldRow field={field()} onAccept={onAccept} onEdit={vi.fn()} onMarkMissing={vi.fn()} />,
    ).container);
    fireEvent.click(q.getByRole("button", { name: /confirm/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("typing in the value input reports an edit", () => {
    const onEdit = vi.fn();
    const q = within(render(
      <ConfirmFieldRow field={field()} onAccept={vi.fn()} onEdit={onEdit} onMarkMissing={vi.fn()} />,
    ).container);
    fireEvent.change(q.getByLabelText(/Brand name/i), { target: { value: "New Brand" } });
    expect(onEdit).toHaveBeenCalledWith("New Brand");
  });

  it("a missing field offers 'Not on the label' and no Confirm button", () => {
    const onMarkMissing = vi.fn();
    const q = within(render(
      <ConfirmFieldRow field={field({ aiValue: "", value: "", confidence: undefined, reason: "Not read." })}
        onAccept={vi.fn()} onEdit={vi.fn()} onMarkMissing={onMarkMissing} />,
    ).container);
    fireEvent.click(q.getByRole("button", { name: /not on the label/i }));
    expect(onMarkMissing).toHaveBeenCalledTimes(1);
    expect(q.queryByRole("button", { name: /confirm/i })).toBeNull();
  });

  it("a non-editable field (warning) renders no input", () => {
    const q = within(render(
      <ConfirmFieldRow field={field({ key: "governmentWarning", label: "Government warning", aiValue: "GOVERNMENT WARNING: ...", value: "GOVERNMENT WARNING: ...", editable: false, status: "pass", flagged: false, needsConfirmation: false, state: "unconfirmed", reason: "Present with an ALL-CAPS prefix." })}
        onAccept={vi.fn()} onEdit={vi.fn()} onMarkMissing={vi.fn()} />,
    ).container);
    expect(q.queryByRole("textbox")).toBeNull();
  });
});
