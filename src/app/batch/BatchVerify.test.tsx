// @vitest-environment jsdom
/**
 * BatchVerify.test.tsx — batch verify-against-application: an application-values CSV produces a
 * per-product Approve/Review/Reject verdict alongside the completeness check.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BatchVerify } from "./BatchVerify";
import { downloadJson, downloadCsv } from "../ui/download";
import type { VerifyApiResponse } from "../api/verify/contract";
import { parseClaimedCsv } from "@/batch/csv";
import { CANONICAL_GOVERNMENT_WARNING } from "@/domain";

// Stub the canvas downscale (variable-timing in jsdom) so the read settles deterministically.
vi.mock("../imageDownscale", () => ({
  downscaleForUpload: (file: File) => Promise.resolve(file),
}));
// Stub the file-download side effect so the export payload can be inspected without a real download.
vi.mock("../ui/download", () => ({ downloadJson: vi.fn(), downloadCsv: vi.fn() }));

const RESPONSE: VerifyApiResponse = {
  provider: "mock",
  readable: true,
  extracted: {
    brand: "Acme",
    classType: "Vodka",
    alcoholContentText: "40% Alc./Vol.",
    netContents: "750 mL",
    name: "Acme Distillery",
    address: "Peoria, IL",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: { brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96, name: 0.95, address: 0.95, warningText: 0.97 },
  },
  result: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear(); // the worklist persists across mounts; isolate each test
});

describe("BatchVerify — verify against an application CSV", () => {
  it("shows an Approve/Review/Reject verdict for a product matched by the claimed CSV", { retry: 2 }, async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => RESPONSE })) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);

    // Upload one label image into the dropzone (accept="image/*").
    const imageInput = container.querySelector('input[accept="image/*"]') as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: { files: [new File(["x"], "acme-front.png", { type: "image/png" })] },
    });

    // Upload the application-values CSV (matched to the product by the image filename). jsdom's File
    // lacks Blob.text() (standard in browsers), so stub it on this file.
    const csv = "filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.";
    const csvFile = new File([csv], "claims.csv", { type: "text/csv" });
    Object.defineProperty(csvFile, "text", { value: () => Promise.resolve(csv) });
    const csvInput = q.getByLabelText(/Application values CSV/i) as HTMLInputElement;
    fireEvent.change(csvInput, { target: { files: [csvFile] } });

    // Wait for the async CSV parse to commit (so process() sees the loaded claimed values).
    await q.findByText(/application row\(s\) loaded/i);
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));

    // The product matches a claimed row, so verifyLabel runs and a verdict badge appears (human label).
    expect(await q.findByText("Approve")).toBeTruthy();
  });

  async function run(csv: string, fetchImpl?: typeof fetch): Promise<ReturnType<typeof within>> {
    globalThis.fetch = (fetchImpl ??
      (vi.fn(async () => ({ ok: true, json: async () => RESPONSE })) as unknown as typeof fetch));
    const { container } = render(<BatchVerify />);
    const q = within(container);
    fireEvent.change(container.querySelector('input[accept="image/*"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "acme-front.png", { type: "image/png" })] },
    });
    const csvFile = new File([csv], "claims.csv", { type: "text/csv" });
    Object.defineProperty(csvFile, "text", { value: () => Promise.resolve(csv) });
    fireEvent.change(q.getByLabelText(/Application values CSV/i) as HTMLInputElement, { target: { files: [csvFile] } });
    await q.findByText(/application row\(s\) loaded/i);
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    return q;
  }

  it("shows a reject verdict when the claimed brand does not match the label", { retry: 2 }, async () => {
    const q = await run("filename,brand,alcohol\nacme-front.png,Totally Different Co,40% Alc./Vol.");
    expect(await q.findByText("Reject")).toBeTruthy();
  });

  it("shows 'no application row' for a product the CSV does not cover", { retry: 2 }, async () => {
    const q = await run("filename,brand,alcohol\nsomething-else.png,X,40% Alc./Vol.");
    expect(await q.findByText(/no application row/i)).toBeTruthy();
  });

  it("surfaces a request failure as an error note, not a fabricated verdict", { retry: 2 }, async () => {
    const q = await run(
      "filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.",
      vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );
    expect(await q.findByText(/Request failed/i)).toBeTruthy();
  });

  it("includes the application-match verdict in the JSON export (parity with the CSV + single screen)", { retry: 2 }, async () => {
    const q = await run("filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.");
    expect(await q.findByText("Approve")).toBeTruthy();
    fireEvent.click(q.getByRole("button", { name: /Download JSON/i }));
    const rows = (downloadJson as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0]).toHaveProperty("overall", "approve");
    expect(rows[0]).toHaveProperty("result");
  });

  it("prompts for the missing alcohol value when a matched claim has a brand but no alcohol", { retry: 2 }, async () => {
    // The verdict needs BOTH brand and alcohol; a brand-only row used to render a blank cell (or a
    // misleading 're-scan' on a perfectly readable label). Surface a clear, actionable prompt instead.
    const q = await run("filename,brand\nacme-front.png,Acme");
    expect(await q.findByText(/add alcohol content/i)).toBeTruthy();
    expect(q.queryByText(/no application row/i)).toBeNull();
    expect(q.queryByText(/re-scan/i)).toBeNull();
  });

  it("the review drawer carries no orphaned 'Step 3' eyebrow (that numbering is the single screen's)", { retry: 2 }, async () => {
    const q = await run("filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.");
    expect(await q.findByText("Approve")).toBeTruthy();
    fireEvent.click(q.getByRole("button", { name: /^Review$/i }));
    // The drawer renders outside the component container; query the whole document.
    expect(await screen.findByText(/Label vs\. application/)).toBeTruthy();
    expect(screen.queryByText(/Step 3/)).toBeNull();
  });

  it("the CSV template includes the three bundled sample labels, ready to demo end to end", () => {
    const { container } = render(<BatchVerify />);
    fireEvent.click(within(container).getByRole("button", { name: /Download CSV template/i }));
    const content = (downloadCsv as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as string;
    const map = parseClaimedCsv(content);
    expect(map.get("demo-old-tom-clean.png")?.brand).toBe("OLD TOM DISTILLERY");
    expect(map.get("demo-warning-title-case.png")?.alcoholContent).toBe("45% Alc./Vol. (90 Proof)");
    expect(map.get("demo-brand-typo.png")?.brand).toBe("Old Tom Distillery");
    expect(map.get("jolly-jerrys-front.jpg")?.classType).toBe("Rum"); // the varied examples stay
  });

  it("a CSV with no usable rows shows an actionable error instead of silently loading nothing", { retry: 2 }, async () => {
    const { container } = render(<BatchVerify />);
    const q = within(container);
    const csv = "image,brand\nx.png,Acme"; // no filename column -> zero usable rows
    const csvFile = new File([csv], "claims.csv", { type: "text/csv" });
    Object.defineProperty(csvFile, "text", { value: () => Promise.resolve(csv) });
    fireEvent.change(q.getByLabelText(/Application values CSV/i), { target: { files: [csvFile] } });
    expect(await q.findByText(/No usable rows/i)).toBeTruthy();
    expect(q.queryByText(/application row\(s\) loaded/i)).toBeNull();
  });

  it("the 'add images' validation error clears once images are added", { retry: 2 }, async () => {
    const { container } = render(<BatchVerify />);
    const q = within(container);
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    expect(await q.findByText(/Add one or more label images/i)).toBeTruthy();
    fireEvent.change(container.querySelector('input[accept="image/*"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    expect(q.queryByText(/Add one or more label images/i)).toBeNull();
  });

  it("a malt-beverage row WITHOUT alcohol still gets a verdict (ABV optional, 27 CFR 7.63(a)(3))", { retry: 2 }, async () => {
    const MALT: VerifyApiResponse = {
      provider: "mock",
      readable: true,
      result: null,
      extracted: {
        brand: "Granite Peak", classType: "India Pale Ale", alcoholContentText: "6.5% Alc./Vol.",
        netContents: "12 FL OZ", name: "Granite Peak Brewing", address: "Portland, OR",
        warningText: CANONICAL_GOVERNMENT_WARNING, warningPrefixIsAllCaps: true, warningPrefixIsBold: true,
        confidence: { brand: 0.97, classType: 0.96, alcoholContent: 0.96, netContents: 0.95, name: 0.95, address: 0.94, warningText: 0.97 },
      },
    };
    const q = await run(
      'filename,brand,class,net,name,address\nacme-front.png,Granite Peak,India Pale Ale,12 FL OZ,Granite Peak Brewing,"Portland, OR"',
      vi.fn(async () => ({ ok: true, json: async () => MALT })) as unknown as typeof fetch,
    );
    // Alcohol is optional on malt: the row verdicts (the un-supplied alcohol comparison stays review-
    // biased, so "Needs review" at best) instead of dead-ending on an "add alcohol content" prompt.
    expect(await q.findByText("Needs review")).toBeTruthy();
    expect(q.queryByText(/add alcohol content/i)).toBeNull();
  });

  it("opens a product's review drawer, records a decision, and persists it to the worklist", { retry: 2 }, async () => {
    const q = await run("filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.");
    expect(await q.findByText("Approve")).toBeTruthy();
    fireEvent.click(q.getByRole("button", { name: /^Review$/i }));
    // The drawer is portaled to document.body, so query the whole screen, not the render container.
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: /Approve COLA/i }));
    fireEvent.click(dialog.getByRole("button", { name: /Record decision & send email/i }));
    // The recorded decision persists to the worklist (the lifecycle, distinct from the AI verdict).
    const stored = JSON.parse(window.localStorage.getItem("ttb-worklist-v1") ?? "{}");
    expect(Object.values(stored).some((r) => (r as { decision?: string }).decision === "approve")).toBe(true);
  });

  it("brings single-mode flag resolution to batch: confirming a gated field settles the verdict", { retry: 2 }, async () => {
    // 740 mL matches the application but is not an authorized standard of fill -> completeness gates it.
    const oddFill = { ...RESPONSE, extracted: { ...RESPONSE.extracted, netContents: "740 mL" } };
    const q = await run(
      "filename,brand,alcohol,net\nacme-front.png,Acme,40% Alc./Vol.,740 mL",
      vi.fn(async () => ({ ok: true, json: async () => oddFill })) as unknown as typeof fetch,
    );
    expect(await q.findByText("Needs review")).toBeTruthy(); // gated in the table
    fireEvent.click(q.getByRole("button", { name: /^Review$/i }));
    const dialog = within(await screen.findByRole("dialog"));
    const netCard = dialog.getAllByText("Net contents")[0].closest("li") as HTMLElement;
    fireEvent.click(within(netCard).getByRole("button", { name: /Looks correct/i }));
    // Clearing a hard CFR violation takes the deliberate confirm step, then the verdict settles.
    fireEvent.click(within(netCard).getByRole("button", { name: /Yes, mark correct/i }));
    expect(dialog.getByText("Approve")).toBeTruthy();
  });

  it("flags a matched-but-unreadable product as 're-scan', not 'no application row'", { retry: 2 }, async () => {
    const unreadable: VerifyApiResponse = {
      provider: "mock",
      readable: false,
      extracted: RESPONSE.extracted,
      result: null,
      message: "We couldn't read this label clearly.",
    };
    const q = await run(
      "filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.",
      vi.fn(async () => ({ ok: true, json: async () => unreadable })) as unknown as typeof fetch,
    );
    expect(await q.findByText(/couldn.t read label; re-scan/i)).toBeTruthy();
    expect(q.queryByText(/no application row/i)).toBeNull();
  });
});
