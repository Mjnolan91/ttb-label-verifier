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
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
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
    // The results section itself must not render yet (the spine at the top always names the steps,
    // so probe the ResultView region, not its heading text).
    expect(q.queryByRole("region", { name: "Verification result" })).toBeNull();
  });

  it("accepting the AI suggestions completes the application and leads with an Approve comparison", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    expect(await q.findByRole("region", { name: "Verification result" })).toBeTruthy();
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
    expect(q.queryByRole("region", { name: "Verification result" })).toBeNull(); // still blocked
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
    const panel = within(await q.findByRole("region", { name: "Verification result" }));
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
    // "Brand name" appears both as the Step 2 input label and as the comparison card title; the
    // card is the match that lives inside the result list's <li>.
    const brandCard = q.getAllByText("Brand name").map((el) => el.closest("li")).find(Boolean) as HTMLElement;
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
    // "Brand name" appears both as the Step 2 input label and as the comparison card title; the
    // card is the match that lives inside the result list's <li>.
    const brandCard = q.getAllByText("Brand name").map((el) => el.closest("li")).find(Boolean) as HTMLElement;
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
    // "Brand name" appears both as the Step 2 input label and as the comparison card title; the
    // card is the match that lives inside the result list's <li>.
    const brandCard = q.getAllByText("Brand name").map((el) => el.closest("li")).find(Boolean) as HTMLElement;
    fireEvent.click(within(brandCard).getByRole("button", { name: /Flag a problem/i }));
    // A note field appears on the flagged card; the reviewer's words land in the applicant email.
    const noteField = within(brandCard).getByPlaceholderText(/Explain the problem/i);
    fireEvent.change(noteField, { target: { value: "Brand is misspelled on the label." } });
    // The note is a draft until saved: it reaches the email only after "Save note".
    fireEvent.click(within(brandCard).getByRole("button", { name: /Save note/i }));
    expect(within(brandCard).getByText(/Saved, added to the applicant email/i)).toBeTruthy();
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
    // ^ anchors: the FieldHelp toggletip's aria-label ("About Statement of composition") would
    // otherwise match too.
    const soc = q.getByLabelText(/^Statement of composition/i) as HTMLInputElement;
    const fanciful = q.getByLabelText(/^Distinctive \/ fanciful name/i) as HTMLInputElement;
    expect(soc.required).toBe(false);
    expect(fanciful.required).toBe(false);
    // Accepting the AI suggestions (which carry no fanciful/SoC for a standard bourbon) still verifies.
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    expect(await q.findByRole("region", { name: "Verification result" })).toBeTruthy();
    expect(q.getByText("Approve")).toBeTruthy();
  });

  it("offers to refresh the email when a field note changes after the decision was drafted", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    // "Brand name" appears both as the Step 2 input label and as the comparison card title; the
    // card is the match that lives inside the result list's <li>.
    const brandCard = q.getAllByText("Brand name").map((el) => el.closest("li")).find(Boolean) as HTMLElement;
    fireEvent.click(within(brandCard).getByRole("button", { name: /Flag a problem/i }));
    fireEvent.click(q.getByRole("button", { name: /Reject \/ send back/i })); // drafts the email
    // Change + save a field note AFTER drafting -> the panel surfaces a refresh affordance.
    const noteField = within(brandCard).getByPlaceholderText(/Explain the problem/i);
    fireEvent.change(noteField, { target: { value: "Brand misspelled on the label." } });
    fireEvent.click(within(brandCard).getByRole("button", { name: /Save note/i }));
    fireEvent.click(q.getByRole("button", { name: /Update the email from your field notes/i }));
    const composer = q.getByLabelText(/Reviewer notes/i) as HTMLTextAreaElement;
    expect(composer.value).toMatch(/Brand misspelled on the label\./);
  });

  it("clears the typed application when the front label is removed (a new product, not stuck on the last image)", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    expect((q.getByLabelText(/^Brand/i) as HTMLInputElement).value).toBe("Old Tom Distillery");
    // Removing the front (the realistic "replace" = Remove + re-add) drops the old application.
    fireEvent.click(q.getByRole("button", { name: /^Remove Front/i }));
    expect((q.getByLabelText(/^Brand/i) as HTMLInputElement).value).toBe("");
  });

  it("lets a reviewer clear a low-confidence field and Tab past it without the suggestion being forced back", ASYNC, async () => {
    const fuzzy = extractedBourbon({
      confidence: { brand: 0.55, classType: 0.97, alcoholContent: 0.98, netContents: 0.96, name: 0.95, address: 0.95, warningText: 0.96 },
    });
    mockFetch(READ_OK(fuzzy));
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    const brand = q.getByLabelText(/^Brand/i) as HTMLInputElement;
    // Untouched: Tab still accepts the suggestion (the accelerator works).
    fireEvent.keyDown(brand, { key: "Tab" });
    expect(brand.value).toBe("Old Tom Distillery");
    // Clear it, then Tab again -> it stays empty (a touched field isn't re-injected against the reviewer).
    fireEvent.change(brand, { target: { value: "" } });
    fireEvent.keyDown(brand, { key: "Tab" });
    expect(brand.value).toBe("");
  });

  it("shows two explicit upload slots (front + back), each with its own file input", () => {
    const { container } = render(<VerifyForm />);
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(2);
    expect(within(container).getAllByText(/Front label/i).length).toBeGreaterThan(0);
    expect(within(container).getAllByText(/Back label/i).length).toBeGreaterThan(0);
  });

  it("MULTI-SELECT: filename tokens route front + back to their slots with ONE read", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    const frontInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(frontInput, {
      target: {
        files: [
          new File(["a"], "bonny-front.png", { type: "image/png" }),
          new File(["b"], "bonny-back.png", { type: "image/png" }),
        ],
      },
    });
    await q.findByText("Complete the application to verify");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // one placement, one read
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const fd = (calls[calls.length - 1][1] as RequestInit).body as FormData;
    expect(fd.getAll("position")).toEqual(["front", "back"]);
    expect(q.getByRole("button", { name: /^Remove Front/ })).toBeTruthy();
    expect(q.getByRole("button", { name: /^Remove Back/ })).toBeTruthy();
  });

  it("MULTI-SELECT: tokenless files fill empty slots in order, auto-revealing the neck slot", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    const frontInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(frontInput, {
      target: {
        files: [
          new File(["a"], "photo-one.png", { type: "image/png" }),
          new File(["b"], "photo-two.png", { type: "image/png" }),
          new File(["c"], "photo-three.png", { type: "image/png" }),
        ],
      },
    });
    await q.findByText("Complete the application to verify");
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const fd = (calls[calls.length - 1][1] as RequestInit).body as FormData;
    expect(fd.getAll("position")).toEqual(["front", "back", "neck"]);
    expect(q.getAllByText(/Neck \/ strip label/i).length).toBeGreaterThan(0); // revealed by placement
  });

  it("MULTI-SELECT: a tokenless file dropped on the BACK zone fills Back, not Front", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    const backInput = q.getByLabelText("Upload back label (optional)") as HTMLInputElement;
    fireEvent.change(backInput, {
      target: { files: [new File(["b"], "whatever.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(q.getByRole("button", { name: /^Remove Back/ })).toBeTruthy());
    expect(q.queryByRole("button", { name: /^Remove Front/ })).toBeNull(); // front stays empty
  });

  it("MULTI-SELECT: overflow files surface an honest notice instead of silent loss", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    const frontInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(frontInput, {
      target: {
        files: [1, 2, 3, 4].map((n) => new File(["x"], `photo-${n}.png`, { type: "image/png" })),
      },
    });
    await q.findByText("Complete the application to verify");
    expect(q.getByText(/not used/i)).toBeTruthy();
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const fd = (calls[calls.length - 1][1] as RequestInit).body as FormData;
    expect(fd.getAll("image")).toHaveLength(3); // three slots, three images
  });

  it("MULTI-SELECT: an explicit front token replacing the loaded front resets the application", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container); // old-tom.png into Front
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    expect((q.getByLabelText(/^Brand/i) as HTMLInputElement).value).toBe("Old Tom Distillery");
    // A new product's front arrives via the Back zone picker, claiming the Front slot by token.
    const backInput = q.getByLabelText("Upload back label (optional)") as HTMLInputElement;
    fireEvent.change(backInput, {
      target: { files: [new File(["n"], "bonny-front.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect((q.getByLabelText(/^Brand/i) as HTMLInputElement).value).toBe(""),
    ); // the old product's typed application is gone
  });

  it("hides the neck/strip slot behind an 'Add a neck or strip label' button until asked for", () => {
    const { container } = render(<VerifyForm />);
    const q = within(container);
    // Default view is unchanged: two slots, no third dropzone.
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(2);
    expect(q.queryByText(/Neck \/ strip label/i)).toBeNull();
    fireEvent.click(q.getByRole("button", { name: /Add a neck or strip label/i }));
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(3);
    expect(q.getAllByText(/Neck \/ strip label/i).length).toBeGreaterThan(0);
    // The disclosure button is gone while the slot is open.
    expect(q.queryByRole("button", { name: /Add a neck or strip label/i })).toBeNull();
  });

  it("reads the neck image with position 'neck' after the front, and collapses the slot on remove", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Add a neck or strip label/i }));
    const neckInput = q.getByLabelText("Upload neck or strip label (optional)") as HTMLInputElement;
    fireEvent.change(neckInput, {
      target: { files: [new File(["n"], "old-tom-neck.png", { type: "image/png" })] },
    });
    // The neck image joins the SAME product read: one POST with front first, then neck.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const fd = (calls[calls.length - 1][1] as RequestInit).body as FormData;
    expect(fd.getAll("position")).toEqual(["front", "neck"]);
    // Removing the neck collapses the slot back to the disclosure button; the front stays put.
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /^Remove Neck/i }));
    expect(q.queryByText(/Neck \/ strip label/i)).toBeNull();
    expect(q.getByRole("button", { name: /Add a neck or strip label/i })).toBeTruthy();
    expect(q.getByRole("button", { name: /^Remove Front/i })).toBeTruthy();
  });

  it("offers sample label downloads while the front slot is empty, hidden once an image is in", ASYNC, async () => {
    mockFetch(READ_OK());
    const { container } = render(<VerifyForm />);
    const q = within(container);
    const clean = q.getByRole("link", { name: /clean bourbon/i }) as HTMLAnchorElement;
    expect(clean.getAttribute("href")).toBe("/samples/demo-old-tom-clean.png");
    expect(clean.hasAttribute("download")).toBe(true);
    expect(
      (q.getByRole("link", { name: /title-case warning/i }) as HTMLAnchorElement).getAttribute("href"),
    ).toBe("/samples/demo-warning-title-case.png");
    expect(
      (q.getByRole("link", { name: /brand typo/i }) as HTMLAnchorElement).getAttribute("href"),
    ).toBe("/samples/demo-brand-typo.png");
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    expect(q.queryByRole("link", { name: /clean bourbon/i })).toBeNull();
  });

  it("a failed read shows Try again, which retries WITHOUT wiping typed application values", ASYNC, async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("network down");
      return { ok: true, json: async () => READ_OK() };
    }) as unknown as typeof fetch;
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    expect(await q.findByText(/Could not reach the label reader/)).toBeTruthy();
    // The agent already typed an application value; recovery must not cost them their work.
    fireEvent.change(q.getByLabelText(/^Brand/i), { target: { value: "Old Tom Distillery" } });
    fireEvent.click(q.getByRole("button", { name: /try again/i }));
    expect(await q.findByText("Complete the application to verify")).toBeTruthy();
    expect((q.getByLabelText(/^Brand/i) as HTMLInputElement).value).toBe("Old Tom Distillery");
    expect(calls).toBe(2);
  });

  it("removing the failed image clears the error banner (no unactionable leftover alert)", ASYNC, async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    expect(await q.findByText(/Could not reach the label reader/)).toBeTruthy();
    fireEvent.click(q.getByRole("button", { name: /^Remove Front/i }));
    expect(q.queryByText(/Could not reach the label reader/)).toBeNull();
  });

  it("WARNS when one of the product's images couldn't be read, and offers a retry", ASYNC, async () => {
    mockFetch({
      ...READ_OK(),
      imageFailures: [{ filename: "old-tom-back.png", position: "back", reason: "timeout" }],
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    // The partial-read warning names the failed slot; a silent drop must never look like a clean read.
    const banner = await q.findByRole("alert");
    expect(banner.textContent).toMatch(/Back label/i);
    expect(banner.textContent).toMatch(/couldn.t be read/i);
    fireEvent.click(within(banner).getByRole("button", { name: /Try reading again/i }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
  });

  it("a partial read CAPS the headline at Needs review even when every compared field matches", ASYNC, async () => {
    mockFetch({
      ...READ_OK(),
      imageFailures: [{ filename: "old-tom-back.png", position: "back", reason: "timeout" }],
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Complete the application to verify");
    fireEvent.click(q.getByRole("button", { name: /Accept all AI suggestions/i }));
    // Same data approves in the clean-read test above; with an unread image the verdict must not.
    const verdict = within(await q.findByRole("region", { name: "Verification result" }));
    expect(verdict.getAllByText("Needs review").length).toBeGreaterThan(0);
    expect(verdict.queryByText("Approve")).toBeNull();
  });

  it("suppresses the partial-read banner on the unreadable path (the re-upload prompt owns that state)", ASYNC, async () => {
    mockFetch({
      provider: "mock", readable: false, extracted: extractedBourbon(), result: null,
      message: "We couldn't read this label clearly. Please re-upload a clearer, well-lit photo.",
      imageFailures: [{ filename: "old-tom-back.png", position: "back", reason: "timeout" }],
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    expect(await q.findByText(/Couldn.t read the label/i)).toBeTruthy();
    // No second, contradictory alert claiming "results below" when there are none.
    expect(q.queryByText(/results below reflect/i)).toBeNull();
  });

  it("shows the re-upload prompt for an unreadable image (never a fabricated verdict)", ASYNC, async () => {
    mockFetch({
      provider: "mock", readable: false, extracted: extractedBourbon(), result: null,
      message: "We couldn't read this label clearly. Please re-upload a clearer, well-lit photo.",
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    expect(await q.findByText(/Couldn.t read the label/i)).toBeTruthy();
    expect(q.queryByRole("region", { name: "Verification result" })).toBeNull();
    expect(q.queryByText("Complete the application to verify")).toBeNull();
  });
});
