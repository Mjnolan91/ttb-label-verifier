// @vitest-environment jsdom
/**
 * VerifyForm.test.tsx — component/integration tests for the single-label screen.
 *
 * These lock the wiring the pure suites can't: a readable extraction prompts to COMPLETE the
 * application (the required set is dynamic per beverage type); accepting the AI's suggestions turns the
 * headline into the label-vs-application comparison (Approve / Needs review / Reject); the verdict is
 * BLOCKED until every TTB-required field for the type is supplied; and the unreadable path shows the
 * re-upload prompt rather than a fabricated result. Fetch + object-URL are mocked; the verdict is
 * computed by the real pure combinedVerdict.
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
// (combinedVerdict, completeness, requiredInputKeysFor) is covered without retry in the pure suites.
const ASYNC = { retry: 2 } as const;

const READ_OK = (extracted = extractedBourbon()): VerifyApiResponse => ({
  provider: "mock", readable: true, extracted, result: null,
});

describe("VerifyForm — verify against the application", () => {
  it("with no application values, prompts to COMPLETE the application (dynamic, per type)", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    expect(await q.findByText("Complete the application to verify")).toBeTruthy();
    expect(q.queryByText(/Label vs\. application/)).toBeNull();
  });

  it("accepting the AI suggestions completes the application and leads with an Approve comparison", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    expect(await q.findByText(/Label vs\. application/)).toBeTruthy();
    expect(q.getByText("Approve")).toBeTruthy();
  });

  it("BLOCKS the verdict until every TTB-required field for the type is supplied", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    // Brand + alcohol alone is NOT enough for distilled spirits (also needs class/type, net, name, address).
    fireEvent.change(q.getByLabelText(/^Brand/i), { target: { value: "Old Tom Distillery" } });
    fireEvent.change(q.getByLabelText(/^Alcohol content/i), { target: { value: "45% Alc./Vol." } });
    expect(q.queryByText(/Label vs\. application/)).toBeNull(); // still blocked
    expect(q.getByText("Complete the application to verify")).toBeTruthy();
  });

  it("a mismatching application brand rejects with a No match card", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    fireEvent.change(q.getByLabelText(/^Brand/i), { target: { value: "Totally Different Co" } });
    expect(await q.findByText("Reject")).toBeTruthy();
    expect(q.getByText("No match")).toBeTruthy();
  });

  it("a mismatched net contents adds a No match card once the required set is complete", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    fireEvent.change(q.getByLabelText(/^Net contents/i), { target: { value: "375 mL" } }); // label says 750 mL
    await q.findByText(/Label vs\. application/);
    const panel = within(q.getByRole("region", { name: "Verification result" }));
    expect(panel.getByText("Net contents")).toBeTruthy();
    expect(panel.getByText("No match")).toBeTruthy();
    expect(q.getByText("Reject")).toBeTruthy();
  });

  it("marks the per-type required fields after a read (distilled spirits require alcohol)", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    expect((q.getByLabelText(/^Brand/i) as HTMLInputElement).required).toBe(true);
    expect((q.getByLabelText(/^Alcohol content/i) as HTMLInputElement).required).toBe(true);
  });

  it("does NOT require alcohol for a malt beverage (table-of-type optionality is respected)", ASYNC, async () => {
    // A malt-beverage read: alcohol is optional under 27 CFR 7.63(a)(3)/7.65(a), so it must NOT block.
    const malt = extractedBourbon({
      brand: "Granite Peak",
      classType: "India Pale Ale",
      class: "Malt beverage",
      alcoholContentText: "6.5% Alc./Vol.",
      netContents: "12 FL OZ",
      name: "Granite Peak Brewing Co.",
      address: "Portland, OR",
    });
    mockFetch(READ_OK(malt));
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    expect((q.getByLabelText(/^Alcohol content/i) as HTMLInputElement).required).toBe(false);
  });

  it("lets a person FLAG a field the AI passed, turning the verdict to Reject", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    const verdict = within(await q.findByRole("region", { name: "Verification result" }));
    expect(verdict.getByText("Approve")).toBeTruthy();
    const brandCard = q.getAllByText("Brand name")[0].closest("li") as HTMLElement;
    fireEvent.click(within(brandCard).getByRole("button", { name: /Flag a problem/i }));
    expect(verdict.getByText("Reject")).toBeTruthy();
  });

  it("lets a person CONFIRM a fuzzy-read field, resolving Needs review to Approve", ASYNC, async () => {
    const fuzzy = extractedBourbon({
      confidence: { brand: 0.55, classType: 0.97, alcoholContent: 0.98, netContents: 0.96, name: 0.95, address: 0.95, warningText: 0.96 },
    });
    mockFetch(READ_OK(fuzzy));
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    // brand read at 55% -> gated to review. Scope to the comparison region (the completeness view also
    // reads "Needs review" from the same low-confidence read, so an unscoped match is ambiguous).
    const verdict = within(await q.findByRole("region", { name: "Verification result" }));
    expect(verdict.getByText("Needs review")).toBeTruthy();
    const brandCard = q.getAllByText("Brand name")[0].closest("li") as HTMLElement;
    fireEvent.click(within(brandCard).getByRole("button", { name: /Looks correct/i }));
    expect(verdict.getByText("Approve")).toBeTruthy();
  });

  // A completeness-gated review: the label VALUE matches the application, but a TTB-required field is in
  // the wrong format (740 mL is not an authorized standard of fill). The verdict must be RESOLVABLE — the
  // reviewer confirms or flags the field on its card and the headline settles, never stranded on review.
  const ODD_FILL = () => extractedBourbon({ netContents: "740 mL" });

  it("settles a completeness-gated 'Needs review' to Approve when the reviewer confirms the flagged field", ASYNC, async () => {
    mockFetch(READ_OK(ODD_FILL()));
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    const verdict = within(await q.findByRole("region", { name: "Verification result" }));
    expect(verdict.getAllByText("Needs review").length).toBeGreaterThan(0);
    // The matching net-contents card surfaces the completeness concern with a confirm control. Clearing a
    // hard CFR violation takes a deliberate second step, so "Looks correct" prompts before it applies.
    const netCard = verdict.getAllByText("Net contents")[0].closest("li") as HTMLElement;
    fireEvent.click(within(netCard).getByRole("button", { name: /Looks correct/i }));
    expect(verdict.queryByText("Approve")).toBeNull(); // not yet — still awaiting confirmation
    fireEvent.click(within(netCard).getByRole("button", { name: /Yes, mark correct/i }));
    expect(verdict.getByText("Approve")).toBeTruthy();
  });

  it("settles a completeness-gated 'Needs review' to Reject when the reviewer flags the field", ASYNC, async () => {
    mockFetch(READ_OK(ODD_FILL()));
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    const verdict = within(await q.findByRole("region", { name: "Verification result" }));
    expect(verdict.getAllByText("Needs review").length).toBeGreaterThan(0);
    const netCard = verdict.getAllByText("Net contents")[0].closest("li") as HTMLElement;
    fireEvent.click(within(netCard).getByRole("button", { name: /Flag a problem/i }));
    expect(verdict.getByText("Reject")).toBeTruthy();
  });

  it("warns before clearing a hard CFR violation, and Cancel leaves the verdict unchanged", ASYNC, async () => {
    mockFetch(READ_OK(ODD_FILL()));
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    const verdict = within(await q.findByRole("region", { name: "Verification result" }));
    const netCard = verdict.getAllByText("Net contents")[0].closest("li") as HTMLElement;
    fireEvent.click(within(netCard).getByRole("button", { name: /Looks correct/i }));
    // A confirmation prompt appears (overriding a TTB requirement is deliberate), and Cancel backs out.
    expect(within(netCard).getByText(/Override a TTB requirement\?/i)).toBeTruthy();
    fireEvent.click(within(netCard).getByRole("button", { name: /Cancel/i }));
    expect(within(netCard).queryByText(/Override a TTB requirement\?/i)).toBeNull();
    expect(verdict.queryByText("Approve")).toBeNull();
    expect(verdict.getAllByText("Needs review").length).toBeGreaterThan(0);
  });

  it("lets the reviewer leave a per-field note that flows into the send-back email", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    const brandCard = q.getAllByText("Brand name")[0].closest("li") as HTMLElement;
    fireEvent.click(within(brandCard).getByRole("button", { name: /Flag a problem/i }));
    // A note field appears on the flagged card; the reviewer's words land in the applicant email.
    const noteField = within(brandCard).getByPlaceholderText(/Explain the problem/i);
    fireEvent.change(noteField, { target: { value: "Brand is misspelled on the label." } });
    fireEvent.click(q.getByRole("button", { name: /Reject \/ send back/i }));
    const composer = q.getByLabelText(/Reviewer notes/i) as HTMLTextAreaElement;
    expect(composer.value).toMatch(/Brand is misspelled on the label\./);
  });

  it("offers fanciful name + statement of composition as OPTIONAL application inputs (don't block the verdict)", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    const soc = q.getByLabelText(/Statement of composition/i) as HTMLInputElement;
    const fanciful = q.getByLabelText(/Distinctive \/ fanciful name/i) as HTMLInputElement;
    expect(soc.required).toBe(false);
    expect(fanciful.required).toBe(false);
    // Accepting the AI suggestions (which carry no fanciful/SoC for a standard bourbon) still verifies.
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    expect(await q.findByText(/Label vs\. application/)).toBeTruthy();
    expect(q.getByText("Approve")).toBeTruthy();
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
    expect(q.queryByText(/Label vs\. application/)).toBeNull();
    expect(q.queryByText("Complete the application to verify")).toBeNull();
  });
});
