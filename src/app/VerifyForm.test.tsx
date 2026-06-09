// @vitest-environment jsdom
/**
 * VerifyForm.test.tsx — component/integration tests for the single-label screen.
 *
 * These lock the wiring the rest of the suite can't: that a readable extraction triggers the
 * confirm-to-approve panel, that low-confidence fields block Approve until confirmed, and that
 * the unreadable path shows the re-upload prompt rather than a fabricated result.
 * Fetch + object-URL are mocked; the verdict itself is computed by the real pure confirmVerdict.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { VerifyForm } from "./VerifyForm";
import type { VerifyApiResponse } from "./api/verify/contract";
import { CANONICAL_GOVERNMENT_WARNING, type ExtractedFields } from "@/domain";

// Skip the real canvas-based downscale in jsdom: it does variable-timing async work that can leave a
// read() in flight past test cleanup (leaking a second component instance and flaking queries). The
// identity passthrough keeps read() deterministic; downscale has its own unit coverage.
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

function dropLabelImage(root: HTMLElement): void {
  const input = root.querySelector('input[type="file"]') as HTMLInputElement;
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

// The image-dropping tests exercise the full async upload -> read -> verify flow. Under jsdom +
// React 19, RTL cleanup occasionally races a settling read (~2% with scoped queries + a stubbed
// downscale), so these integration tests carry a small bounded retry. The deterministic logic they
// rely on (confirmVerdict, completeness, the merge) is covered without retry in the pure unit suites.
const ASYNC = { retry: 2 } as const;

describe("VerifyForm — confirm-to-approve", () => {
  it("a clean high-confidence label resolves to Approve with nothing to confirm", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    expect(await q.findByText("Confirm the required fields")).toBeTruthy();
    expect(q.getByText("Approve")).toBeTruthy();
  });

  it("a low-confidence field is hoisted and blocks Approve until confirmed", ASYNC, async () => {
    mockFetch({
      provider: "mock", readable: true,
      extracted: extractedBourbon({ confidence: { ...extractedBourbon().confidence, brand: 0.4 } }),
      result: null,
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Confirm the required fields");
    expect(q.getByText("Needs your check")).toBeTruthy();
    expect(q.queryByText("Approve")).toBeNull();
    fireEvent.click(q.getByRole("button", { name: /Confirm Brand name/i }));
    expect(await q.findByText("Approve")).toBeTruthy();
  });

  it("marking a missing mandatory field 'Not on the label' rejects", ASYNC, async () => {
    mockFetch({
      provider: "mock", readable: true,
      extracted: extractedBourbon({ netContents: undefined }),
      result: null,
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Confirm the required fields");
    fireEvent.click(q.getByRole("button", { name: /Mark Net contents as not on the label/i }));
    expect(await q.findByText("Reject")).toBeTruthy();
  });

  it("shows two explicit upload slots (front + back), each with its own file input", () => {
    const { container } = render(<VerifyForm />);
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(2);
    expect(within(container).getAllByText(/Front label/i).length).toBeGreaterThan(0);
    expect(within(container).getAllByText(/Back label/i).length).toBeGreaterThan(0);
  });

  it("changing the beverage type recomputes the required-field set", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Confirm the required fields");
    // Scope to the confirm panel only (the full reading below also lists every field).
    const panel = within(q.getByRole("region", { name: "Confirm the label against the application" }));
    // Bourbon -> distilled spirits: Age statement is in the required set, Appellation is not.
    expect(panel.queryAllByText("Age statement").length).toBeGreaterThan(0);
    expect(panel.queryAllByText("Appellation of origin").length).toBe(0);
    // Override to Wine (45% ABV -> wine > 14%): Appellation joins the set, Age statement leaves it.
    fireEvent.change(q.getByLabelText("Beverage type"), { target: { value: "wine" } });
    expect((await panel.findAllByText("Appellation of origin")).length).toBeGreaterThan(0);
    expect(panel.queryAllByText("Age statement").length).toBe(0);
  });

  it("a fresh read resets the beverage-type override to the AI's reading (AC-6)", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Confirm the required fields");
    // Override to Wine and confirm it took.
    fireEvent.change(q.getByLabelText("Beverage type"), { target: { value: "wine" } });
    await waitFor(() => expect((q.getByLabelText("Beverage type") as HTMLSelectElement).value).toBe("wine"));
    // A fresh read (new image) must reset the override back to the AI-read class.
    dropLabelImage(container);
    await waitFor(() => expect((q.getByLabelText("Beverage type") as HTMLSelectElement).value).toBe("distilledSpirits"));
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
    expect(q.queryByText("Confirm the required fields")).toBeNull();
  });
});
