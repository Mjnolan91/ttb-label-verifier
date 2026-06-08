// @vitest-environment jsdom
/**
 * VerifyForm.test.tsx — component/integration tests for the single-label screen.
 *
 * These lock the wiring the rest of the suite can't: that a readable extraction is shown, that the
 * optional "verify against an application" panel renders the deterministic verdict, and that the
 * unreadable path shows the re-upload prompt rather than a fabricated result. Fetch + object-URL are
 * mocked; the verdict itself is computed by the real pure comparator (verifyLabel).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VerifyForm } from "./VerifyForm";
import type { VerifyApiResponse } from "./api/verify/contract";
import { CANONICAL_GOVERNMENT_WARNING, type ExtractedFields } from "@/domain";

function extractedBourbon(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brand: "Old Tom Distillery",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    name: "Old Tom Distillery",
    address: "Louisville, KY",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: {
      brand: 0.98,
      classType: 0.97,
      alcoholContent: 0.98,
      netContents: 0.96,
      name: 0.95,
      address: 0.95,
      warningText: 0.96,
    },
    ...overrides,
  };
}

function mockFetch(response: VerifyApiResponse): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => response,
  })) as unknown as typeof fetch;
}

function dropLabelImage(): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["x"], "old-tom.png", { type: "image/png" })] },
  });
}

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VerifyForm — claimed-vs-application verification", () => {
  it("renders an Approve verdict when the application matches the label", async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    render(<VerifyForm />);
    dropLabelImage();

    const brand = await screen.findByLabelText(/Brand name/i);
    fireEvent.change(brand, { target: { value: "Old Tom Distillery" } });
    fireEvent.change(screen.getByLabelText(/Alcohol content/i), {
      target: { value: "45% Alc./Vol. (90 Proof)" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check against the application/i }));

    expect(await screen.findByText("Verification result")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
  });

  it("rejects a title-case 'Government Warning' — the strict warning check is visible end-to-end", async () => {
    // Jenny's scenario: a title-case prefix (not ALL CAPS) must be rejected.
    mockFetch({
      provider: "mock",
      readable: true,
      extracted: extractedBourbon({ warningPrefixIsAllCaps: false }),
      result: null,
    });
    render(<VerifyForm />);
    dropLabelImage();

    const brand = await screen.findByLabelText(/Brand name/i);
    fireEvent.change(brand, { target: { value: "Old Tom Distillery" } });
    fireEvent.change(screen.getByLabelText(/Alcohol content/i), {
      target: { value: "45% Alc./Vol. (90 Proof)" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Check against the application/i }));

    expect(await screen.findByText("Reject")).toBeTruthy();
  });

  it("shows the re-upload prompt for an unreadable image (never a fabricated verdict)", async () => {
    mockFetch({
      provider: "mock",
      readable: false,
      extracted: extractedBourbon(),
      result: null,
      message: "We couldn't read this label clearly — please re-upload a clearer, well-lit photo.",
    });
    render(<VerifyForm />);
    dropLabelImage();

    expect(await screen.findByText(/Couldn.t read the label/i)).toBeTruthy();
    expect(screen.queryByText("Verification result")).toBeNull();
  });
});
