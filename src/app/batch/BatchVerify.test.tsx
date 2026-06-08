// @vitest-environment jsdom
/**
 * BatchVerify.test.tsx — batch verify-against-application: an application-values CSV produces a
 * per-product Approve/Review/Reject verdict alongside the completeness check.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { BatchVerify } from "./BatchVerify";
import type { VerifyApiResponse } from "../api/verify/contract";
import { CANONICAL_GOVERNMENT_WARNING } from "@/domain";

// Stub the canvas downscale (variable-timing in jsdom) so the read settles deterministically.
vi.mock("../imageDownscale", () => ({
  downscaleForUpload: (file: File) => Promise.resolve(file),
}));

const RESPONSE: VerifyApiResponse = {
  provider: "mock",
  readable: true,
  extracted: {
    brand: "Acme",
    classType: "Vodka",
    alcoholContentText: "40% Alc./Vol.",
    netContents: "750 mL",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: { brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96, warningText: 0.97 },
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

    // The product matches a claimed row, so verifyLabel runs and a verdict badge appears.
    expect(await q.findByText("approve")).toBeTruthy();
  });
});
