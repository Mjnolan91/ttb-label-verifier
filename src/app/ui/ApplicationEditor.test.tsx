// @vitest-environment jsdom
/**
 * ApplicationEditor.test.tsx — the batch drawer's application editor.
 * Locks the reported regression: the AI's suggestions must show as GREY PLACEHOLDERS inside the
 * empty inputs (single-screen parity), not only as the hint row below; and "Accept all AI
 * suggestions" commits every suggested value through onChange.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ApplicationEditor } from "./ApplicationEditor";
import type { ExtractedFields } from "@/domain";

afterEach(cleanup);

const EXTRACTED = {
  brand: "Old Tom Distillery",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContentText: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  warningPrefixIsAllCaps: true,
  warningPrefixIsBold: true,
  warningRemainderIsBold: null,
  warningIsReadilyLegible: null,
  confidence: { brand: 0.97, classType: 0.95, alcoholContent: 0.96, netContents: 0.94 },
} as ExtractedFields;

function renderEditor(onChange = vi.fn()) {
  render(
    <ApplicationEditor
      extracted={EXTRACTED}
      values={null}
      csvValues={null}
      edits={{}}
      onChange={onChange}
      hasVerdict={false}
    />,
  );
  return onChange;
}

describe("ApplicationEditor — AI suggestions in the empty inputs", () => {
  it("shows each suggestion as the input's grey placeholder (single-screen parity)", () => {
    // The bare value, no "Suggested:" prefix: the labeled-ghost treatment was tried and rejected
    // as noise across the grid (user call, 2026-06-12).
    renderEditor();
    expect((screen.getByLabelText(/^Brand name/) as HTMLTextAreaElement).placeholder).toBe(
      "Old Tom Distillery",
    );
    expect(
      (screen.getByLabelText(/^Class \/ type designation/) as HTMLTextAreaElement).placeholder,
    ).toBe("Kentucky Straight Bourbon Whiskey");
    expect((screen.getByLabelText(/^Alcohol content/) as HTMLTextAreaElement).placeholder).toBe(
      "45% Alc./Vol. (90 Proof)",
    );
  });

  it("Accept all AI suggestions commits every suggested value", () => {
    const onChange = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: /Accept all AI suggestions/i }));
    const written = Object.fromEntries(onChange.mock.calls.map(([k, v]) => [k, v]));
    expect(written.brand).toBe("Old Tom Distillery");
    expect(written.alcoholContent).toBe("45% Alc./Vol. (90 Proof)");
    expect(written.netContents).toBe("750 mL");
  });
});
