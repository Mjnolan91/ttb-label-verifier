// @vitest-environment jsdom
/**
 * BatchVerify.test.tsx — batch verify-against-application: an application-values CSV produces a
 * per-product Approve/Review/Reject verdict alongside the completeness check.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { BatchVerify } from "./BatchVerify";
import { downloadJson } from "../ui/download";
import type { VerifyApiResponse } from "../api/verify/contract";
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
