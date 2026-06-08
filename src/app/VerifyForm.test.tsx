// @vitest-environment jsdom
/**
 * VerifyForm.test.tsx — component/integration tests for the single-label screen.
 *
 * These lock the wiring the rest of the suite can't: that a readable extraction is shown, that the
 * optional "verify against an application" panel renders the deterministic verdict, and that the
 * unreadable path shows the re-upload prompt rather than a fabricated result. Fetch + object-URL are
 * mocked; the verdict itself is computed by the real pure comparator (combinedVerdict).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
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
// rely on (verifyLabel, completeness, the merge) is covered without retry in the pure unit suites.
const ASYNC = { retry: 2 } as const;

describe("VerifyForm — claimed-vs-application verification", () => {
  it("renders an Approve verdict when the application matches the label", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    // Scope every query to THIS render's container (within), so an async read that outlives a sibling
    // test can never make queries match the wrong instance.
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);

    // Wait for the read to complete, THEN fill the application values.
    await q.findByText("Extracted from the label");
    fireEvent.change(q.getByLabelText(/Brand name/i), { target: { value: "Old Tom Distillery" } });
    fireEvent.change(q.getByLabelText(/Alcohol content/i), {
      target: { value: "45% Alc./Vol. (90 Proof)" },
    });

    // The verdict is computed reactively (verify-first) — no button press required.
    expect(await q.findByText("Verification result")).toBeTruthy();
    expect(q.getByText("Approve")).toBeTruthy();
  });

  it("moves focus to the headline verdict on an auto-read (not the 3rd extracted-fields section)", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    // Fill the application values BEFORE uploading, so a verdict exists the instant the read settles.
    fireEvent.change(q.getByLabelText(/Brand name/i), { target: { value: "Old Tom Distillery" } });
    fireEvent.change(q.getByLabelText(/Alcohol content/i), {
      target: { value: "45% Alc./Vol. (90 Proof)" },
    });
    dropLabelImage(container);

    const verdictHeading = await q.findByText("Verification result");
    // Focus lands on the verify-first headline outcome, not the "Extracted from the label" section.
    expect(document.activeElement).toBe(verdictHeading);
  });

  it("rejects a title-case 'Government Warning' — the strict warning check is visible end-to-end", ASYNC, async () => {
    // Jenny's scenario: a title-case prefix (not ALL CAPS) must be rejected.
    mockFetch({
      provider: "mock",
      readable: true,
      extracted: extractedBourbon({ warningPrefixIsAllCaps: false }),
      result: null,
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);

    await q.findByText("Extracted from the label");
    fireEvent.change(q.getByLabelText(/Brand name/i), { target: { value: "Old Tom Distillery" } });
    fireEvent.change(q.getByLabelText(/Alcohol content/i), {
      target: { value: "45% Alc./Vol. (90 Proof)" },
    });

    expect(await q.findByText("Reject")).toBeTruthy();
  });

  it("announces the verdict via a live region on the upload-then-type flow (focus never moves there)", ASYNC, async () => {
    mockFetch({
      provider: "mock",
      readable: true,
      extracted: extractedBourbon({ warningPrefixIsAllCaps: false }),
      result: null,
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Extracted from the label");
    fireEvent.change(q.getByLabelText(/Brand name/i), { target: { value: "Old Tom Distillery" } });
    fireEvent.change(q.getByLabelText(/Alcohol content/i), {
      target: { value: "45% Alc./Vol. (90 Proof)" },
    });

    // A polite live region carries the headline outcome, so a screen-reader/keyboard user is not left
    // in silence on the reactive path where the focus-move announcement never fires.
    const live = await q.findByText(/Verification result: Reject/i);
    expect(live.getAttribute("role")).toBe("status");
  });

  it("shows two explicit upload slots (front + back), each with its own file input", () => {
    const { container } = render(<VerifyForm />);
    // Two empty slots each render a file input before anything is uploaded (front + back).
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(2);
    // Visible slot labels (appear in both the visible heading and sr-only help, so use getAllByText).
    expect(within(container).getAllByText(/Front label/i).length).toBeGreaterThan(0);
    expect(within(container).getAllByText(/Back label/i).length).toBeGreaterThan(0);
  });

  it("shows the application form up front, before any image is uploaded (verify-first)", () => {
    const q = within(render(<VerifyForm />).container); // no read here, so no container ref needed
    // The match check is front-and-center: the application fields are visible without a successful read.
    expect(q.getByLabelText(/Brand name/i)).toBeTruthy();
    expect(q.getByLabelText(/Alcohol content/i)).toBeTruthy();
    expect(q.getByRole("button", { name: /Verify against the application/i })).toBeTruthy();
  });

  it("reads a label without application values: shows the reading, no verdict", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);

    expect(await q.findByText("Extracted from the label")).toBeTruthy();
    // The long field list is behind a progressive-disclosure summary.
    expect(q.getByText(/Show everything we read/i)).toBeTruthy();
    // No application values entered -> no Approve/Reject verdict is fabricated.
    expect(q.queryByText("Verification result")).toBeNull();
  });

  it("shows Needs review (gated by completeness) when the 3 checks pass but a required field is missing", ASYNC, async () => {
    // Net contents omitted -> spirits completeness incomplete -> headline gated to review even though
    // brand/alcohol/warning all match.
    mockFetch({
      provider: "mock",
      readable: true,
      extracted: extractedBourbon({
        netContents: undefined,
        confidence: { brand: 0.98, classType: 0.97, alcoholContent: 0.98, name: 0.95, address: 0.95, warningText: 0.96 },
      }),
      result: null,
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Extracted from the label");
    fireEvent.change(q.getByLabelText(/Brand name/i), { target: { value: "Old Tom Distillery" } });
    fireEvent.change(q.getByLabelText(/Alcohol content/i), { target: { value: "45% Alc./Vol. (90 Proof)" } });

    expect(await q.findByText("Verification result")).toBeTruthy();
    expect(q.getByText("Needs review")).toBeTruthy();
    expect(q.getByText(/a field TTB requires for this beverage type/i)).toBeTruthy();
  });

  it("shows the re-upload prompt for an unreadable image (never a fabricated verdict)", ASYNC, async () => {
    mockFetch({
      provider: "mock",
      readable: false,
      extracted: extractedBourbon(),
      result: null,
      message: "We couldn't read this label clearly — please re-upload a clearer, well-lit photo.",
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);

    expect(await q.findByText(/Couldn.t read the label/i)).toBeTruthy();
    expect(q.queryByText("Verification result")).toBeNull();
  });
});
