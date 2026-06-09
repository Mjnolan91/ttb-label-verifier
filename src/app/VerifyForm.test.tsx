// @vitest-environment jsdom
/**
 * VerifyForm.test.tsx — component/integration tests for the single-label screen.
 *
 * These lock the wiring the pure suites can't: a readable extraction leads with the TTB completeness
 * check; entering the application's brand + alcohol turns the headline into the label-vs-application
 * comparison (Approve / Needs review / Reject); and the unreadable path shows the re-upload prompt
 * rather than a fabricated result. Fetch + object-URL are mocked; the verdict is computed by the real
 * pure combinedVerdict.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { VerifyForm } from "./VerifyForm";
import type { VerifyApiResponse } from "./api/verify/contract";
import { CANONICAL_GOVERNMENT_WARNING, type ExtractedFields } from "@/domain";

// Skip the real canvas-based downscale in jsdom (variable-timing async work that can outlive cleanup).
vi.mock("./imageDownscale", () => ({
  downscaleForUpload: (file: File) => Promise.resolve(file),
}));

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
      brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96,
      name: 0.95, address: 0.95, warningText: 0.96,
    },
    ...overrides,
  };
}

function mockFetch(response: VerifyApiResponse): void {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => response })) as unknown as typeof fetch;
}

function dropLabelImage(root: HTMLElement): void {
  const input = root.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "old-tom.png", { type: "image/png" })] } });
}

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The image-dropping tests exercise the full async upload -> read flow; RTL cleanup can race a
// settling read under jsdom + React 19, so they carry a small bounded retry. The deterministic logic
// (combinedVerdict, completeness) is covered without retry in the pure unit suites.
const ASYNC = { retry: 2 } as const;

describe("VerifyForm — verify against the application", () => {
  it("with no application values, prompts to enter the application (never a completeness-only result)", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    expect(await q.findByText("Enter the application to verify")).toBeTruthy();
    expect(q.queryByText("Label vs. application")).toBeNull();
  });

  it("entering matching application values leads with an Approve comparison", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Enter the application to verify");
    fireEvent.change(q.getByLabelText(/^Brand/i), { target: { value: "Old Tom Distillery" } });
    fireEvent.change(q.getByLabelText(/^Alcohol content/i), { target: { value: "45% Alc./Vol." } });
    expect(await q.findByText("Label vs. application")).toBeTruthy();
    expect(q.getByText("Approve")).toBeTruthy();
  });

  it("a mismatching application brand rejects with a No match card", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Enter the application to verify");
    fireEvent.change(q.getByLabelText(/^Brand/i), { target: { value: "Totally Different Co" } });
    fireEvent.change(q.getByLabelText(/^Alcohol content/i), { target: { value: "45% Alc./Vol." } });
    expect(await q.findByText("Reject")).toBeTruthy();
    expect(q.getByText("No match")).toBeTruthy();
  });

  it("compares an optional field the agent fills (a mismatched net contents adds a No match card)", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Enter the application to verify");
    fireEvent.change(q.getByLabelText(/^Brand/i), { target: { value: "Old Tom Distillery" } });
    fireEvent.change(q.getByLabelText(/^Alcohol content/i), { target: { value: "45% Alc./Vol." } });
    fireEvent.change(q.getByLabelText(/^Net contents/i), { target: { value: "375 mL" } }); // label says 750 mL
    await q.findByText("Label vs. application");
    const panel = within(q.getByRole("region", { name: "Verification result" }));
    expect(panel.getByText("Net contents")).toBeTruthy();
    expect(panel.getByText("No match")).toBeTruthy();
    expect(q.getByText("Reject")).toBeTruthy();
  });

  it("marks brand and alcohol content as required inputs", () => {
    const { container } = render(<VerifyForm />);
    const q = within(container);
    expect((q.getByLabelText(/^Brand/i) as HTMLInputElement).required).toBe(true);
    expect((q.getByLabelText(/^Alcohol content/i) as HTMLInputElement).required).toBe(true);
  });

  it("shows two explicit upload slots (front + back), each with its own file input", () => {
    const { container } = render(<VerifyForm />);
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(2);
    expect(within(container).getAllByText(/Front label/i).length).toBeGreaterThan(0);
    expect(within(container).getAllByText(/Back label/i).length).toBeGreaterThan(0);
  });

  it("shows the re-upload prompt for an unreadable image (never a fabricated verdict)", ASYNC, async () => {
    mockFetch({
      provider: "mock", readable: false, extracted: extractedBourbon(), result: null,
      message: "We couldn't read this label clearly — please re-upload a clearer, well-lit photo.",
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    expect(await q.findByText(/Couldn.t read the label/i)).toBeTruthy();
    expect(q.queryByText("Label vs. application")).toBeNull();
    expect(q.queryByText("Enter the application to verify")).toBeNull();
  });
});
