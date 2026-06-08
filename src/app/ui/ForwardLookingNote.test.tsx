// @vitest-environment jsdom
/**
 * ForwardLookingNote.test.tsx — the non-blocking note for 2025 TTB proposals.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ForwardLookingNote } from "./ForwardLookingNote";

afterEach(cleanup);

describe("ForwardLookingNote", () => {
  it("renders a disclosure listing the three 2025 proposals, each marked not-yet-required", () => {
    render(<ForwardLookingNote />);
    expect(screen.getByText(/proposed rules \(not checked\)/i)).toBeTruthy();
    expect(screen.getByText(/Cancer-risk health warning/i)).toBeTruthy();
    expect(screen.getByText(/Alcohol Facts/i)).toBeTruthy();
    expect(screen.getByText(/Major food allergen labeling/i)).toBeTruthy();
    expect(screen.getAllByText(/Proposed — not yet required/i)).toHaveLength(3);
  });
});
