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
// Collapse the retry backoff to ~1ms so the bounded-persistence flows settle fast under test.
vi.mock("./pacing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pacing")>()),
  retryDelayMs: () => 1,
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

  it("a partial read (one image of the pair failed) surfaces a note on the row, never silence", { retry: 2 }, async () => {
    const partial: VerifyApiResponse = {
      ...RESPONSE,
      imageFailures: [{ filename: "acme-back.png", position: "back", reason: "timeout" }],
    };
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => partial })) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    const imageInput = container.querySelector('input[accept="image/*"]') as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: {
        files: [
          new File(["x"], "acme-front.png", { type: "image/png" }),
          new File(["y"], "acme-back.png", { type: "image/png" }),
        ],
      },
    });
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    expect(await q.findByText(/Back label image couldn.t be read/i)).toBeTruthy();
  });

  it("a partial read caps the row verdict at Needs review, offers Retry, and warns inside the drawer", { retry: 2 }, async () => {
    // Same CSV-matched product that earns Approve in the clean-read test above — but the back image
    // dropped out of the read. An approve on partial evidence is the unshippable false-approval class.
    const partial: VerifyApiResponse = {
      ...RESPONSE,
      imageFailures: [{ filename: "acme-back.png", position: "back", reason: "timeout" }],
    };
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => partial })) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    const imageInput = container.querySelector('input[accept="image/*"]') as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: {
        files: [
          new File(["x"], "acme-front.png", { type: "image/png" }),
          new File(["y"], "acme-back.png", { type: "image/png" }),
        ],
      },
    });
    const csv = "filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.";
    const csvFile = new File([csv], "claims.csv", { type: "text/csv" });
    Object.defineProperty(csvFile, "text", { value: () => Promise.resolve(csv) });
    fireEvent.change(q.getByLabelText(/Application values CSV/i) as HTMLInputElement, { target: { files: [csvFile] } });
    await q.findByText(/application row\(s\) loaded/i);
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    // The row badge is capped: Needs review, not Approve.
    expect(await q.findByText("Needs review")).toBeTruthy();
    expect(q.queryByText("Approve")).toBeNull();
    // A partial row gets a Retry action alongside Review.
    expect(q.getByRole("button", { name: /^Retry/ })).toBeTruthy();
    // And the drawer (the decision surface) repeats the warning — not just the muted row note.
    fireEvent.click(q.getByRole("button", { name: /^Review/ }));
    const drawer = within(await screen.findByRole("dialog"));
    expect(drawer.getByText(/couldn.t be read/i)).toBeTruthy();
  });

  function uploadOne(container: HTMLElement, name = "acme-front.png"): void {
    const imageInput = container.querySelector('input[accept="image/*"]') as HTMLInputElement;
    fireEvent.change(imageInput, { target: { files: [new File(["x"], name, { type: "image/png" })] } });
  }

  it("auto-retries a transient 502 with backoff, then succeeds (the row never dead-ends)", { retry: 2 }, async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls <= 2) {
        return { ok: false, status: 502, json: async () => ({ error: "The label reader is temporarily unavailable. Please try again." }) };
      }
      return { ok: true, json: async () => RESPONSE };
    }) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    uploadOne(container);
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    expect(await q.findByText("Acme")).toBeTruthy(); // the row settled with the extraction
    expect(calls).toBe(3);
  });

  it("a persistently-busy service lands on an HONEST terminal error after 6 bounded attempts", { retry: 2 }, async () => {
    const failing = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "The label reader is temporarily unavailable. Please try again." }),
    }));
    globalThis.fetch = failing as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    uploadOne(container);
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    expect(await q.findByText(/after 6 attempts/i)).toBeTruthy();
    expect(failing).toHaveBeenCalledTimes(6);
    expect(q.getByRole("button", { name: /^Retry$/ })).toBeTruthy(); // manual escape stays
  });

  it("NEVER auto-retries a non-transient failure (validation/config errors surface immediately)", { retry: 2 }, async () => {
    const rejecting = vi.fn(async () => ({
      ok: false,
      status: 415,
      json: async () => ({ error: "Only image files are accepted." }),
    }));
    globalThis.fetch = rejecting as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    uploadOne(container);
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    expect(await q.findByText(/Only image files are accepted/i)).toBeTruthy();
    expect(rejecting).toHaveBeenCalledTimes(1);
  });

  it("a per-row re-read DROPS the recorded decision and overrides (fresh read invalidates)", { retry: 2 }, async () => {
    // The product key for acme-front.png is the stem "acme"; seed a stale Approved record for it.
    window.localStorage.setItem(
      "ttb-worklist-v1",
      JSON.stringify({ acme: { decision: "approve", note: "", overrides: { brand: "ok" } } }),
    );
    const partial: VerifyApiResponse = {
      ...RESPONSE,
      imageFailures: [{ filename: "acme-back.png", position: "back", reason: "timeout" }],
    };
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => partial })) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    uploadOne(container);
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    expect(await q.findByText("Approved")).toBeTruthy(); // the stale decision resurfaced
    fireEvent.click(q.getByRole("button", { name: /^Retry$/ })); // partial rows are retryable
    expect(await q.findByText("Undecided")).toBeTruthy(); // the re-read invalidated it
    expect(q.queryByText("Approved")).toBeNull();
  });

  it("each settled row shows a clickable thumbnail that opens the lightbox", { retry: 2 }, async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => RESPONSE })) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    uploadOne(container);
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    await q.findByText("Acme");
    const thumb = q.getByRole("button", { name: /Show acme front label larger/i });
    fireEvent.click(thumb);
    expect(screen.getByRole("dialog")).toBeTruthy(); // the shared ImageLightbox
  });

  it("a front/back product shows BOTH thumbnails in the row, front first", { retry: 2 }, async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => RESPONSE })) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    const imageInput = container.querySelector('input[accept="image/*"]') as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: {
        files: [
          // Deliberately uploaded back-first: the row must still lead with the front.
          new File(["y"], "acme-back.png", { type: "image/png" }),
          new File(["x"], "acme-front.png", { type: "image/png" }),
        ],
      },
    });
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    await q.findByText("Acme");
    const front = q.getByRole("button", { name: /Show acme front label larger/i });
    const back = q.getByRole("button", { name: /Show acme back label larger/i });
    // Front precedes back in the DOM regardless of upload order.
    expect(front.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("'Retry all failed' re-runs every terminal-error row in one click", { retry: 2 }, async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls <= 2) return { ok: false, status: 415, json: async () => ({ error: "Only image files are accepted." }) };
      return { ok: true, json: async () => RESPONSE };
    }) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    const imageInput = container.querySelector('input[accept="image/*"]') as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: {
        files: [
          new File(["x"], "acme-front.png", { type: "image/png" }),
          new File(["y"], "zenith-front.png", { type: "image/png" }),
        ],
      },
    });
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    const retryAll = await q.findByRole("button", { name: /Retry all failed \(2\)/i });
    fireEvent.click(retryAll);
    expect((await q.findAllByText("Acme")).length).toBeGreaterThan(0); // both rows re-read clean
    expect(calls).toBe(4);
  });

  it("suggests combining two rows that read the SAME brand, and re-reads them as one product", { retry: 2 }, async () => {
    // Camera filenames (IMG_001/IMG_002) defeat filename pairing, so the photos land as two rows.
    // Both read brand "Acme": the worklist offers a deterministic, human-confirmed combine — never
    // a silent auto-merge (a wrong merge contaminates two products' verdicts).
    let lastBody: FormData | null = null;
    let calls = 0;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      calls++;
      lastBody = (init?.body as FormData) ?? null;
      return { ok: true, json: async () => RESPONSE };
    }) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    const imageInput = container.querySelector('input[accept="image/*"]') as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: {
        files: [
          new File(["x"], "IMG_001.png", { type: "image/png" }),
          new File(["y"], "IMG_002.png", { type: "image/png" }),
        ],
      },
    });
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    expect((await q.findAllByText("Acme")).length).toBe(2); // two rows, same brand
    // Row actions stay disabled until the whole run settles (mutual exclusion); wait for enabled.
    await vi.waitFor(() => {
      const b = q.getByRole("button", { name: /Combine and re-read/i }) as HTMLButtonElement;
      expect(b.disabled).toBe(false);
    });
    // Combining drops both rows' review records, so it takes a deliberate second click.
    fireEvent.click(q.getByRole("button", { name: /Combine and re-read/i }));
    expect(q.getByText(/clears their reviews/i)).toBeTruthy();
    fireEvent.click(q.getByRole("button", { name: /Confirm combine/i }));
    // The merged row's meta says "2 images" (the live region announces it too).
    expect((await q.findAllByText(/2 images/i)).length).toBeGreaterThan(0);
    expect(q.getAllByText("Acme")).toHaveLength(1); // ONE merged row carrying both photos
    expect(calls).toBe(3); // two initial reads + one merged re-read
    expect(lastBody && (lastBody as FormData).getAll("position")).toEqual(["front", "back"]); // the duplicate front demoted
  });

  it("changing the image set CLEARS stale combine overrides (no silent merges in a later batch)", { retry: 2 }, async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => RESPONSE })) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    const imageInput = container.querySelector('input[accept="image/*"]') as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: {
        files: [
          new File(["x"], "IMG_001.png", { type: "image/png" }),
          new File(["y"], "IMG_002.png", { type: "image/png" }),
        ],
      },
    });
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    await q.findAllByText("Acme");
    await vi.waitFor(() => {
      const b = q.getByRole("button", { name: /Combine and re-read/i }) as HTMLButtonElement;
      expect(b.disabled).toBe(false);
    });
    fireEvent.click(q.getByRole("button", { name: /Combine and re-read/i }));
    fireEvent.click(q.getByRole("button", { name: /Confirm combine/i }));
    expect((await q.findAllByText(/2 images/i)).length).toBeGreaterThan(0);
    // A new file arrives: the combine override must NOT survive onto the recomputed grouping.
    fireEvent.change(imageInput, {
      target: { files: [new File(["z"], "solo-front.png", { type: "image/png" })] },
    });
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    await waitForRowCount(q, 3); // IMG_001 and IMG_002 are separate products again, plus solo
  });

  async function waitForRowCount(q: ReturnType<typeof within>, n: number): Promise<void> {
    await vi.waitFor(() => {
      const metas = q.getAllByText(/1 image$/);
      expect(metas.length).toBe(n);
    });
  }

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

  it("surfaces a persistent request failure as an honest error note, not a fabricated verdict", { retry: 2 }, async () => {
    // A dead network is transient-shaped, so it gets the bounded auto-retry — and then an honest
    // terminal state, never a made-up verdict.
    const q = await run(
      "filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.",
      vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );
    expect(await q.findByText(/after 6 attempts/i)).toBeTruthy();
    expect(q.getByText("Read failed")).toBeTruthy();
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
    expect(q.queryByText(/upload a clearer image/i)).toBeNull();
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
    // Alcohol is optional on malt: a fully matching, legally ABV-less application VERDICTS — and
    // since every supplied field matches, it can genuinely reach Approve (the unsupplied alcohol
    // row is a named pass per 27 CFR 7.65, not a permanent review).
    expect((await q.findAllByText("Approve")).length).toBeGreaterThan(0);
    expect(q.queryByText(/add alcohol content/i)).toBeNull();
    expect(q.queryByText("Needs review")).toBeNull();
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
    // "Net contents" now ALSO labels the drawer's application-editor input; the comparison CARD is
    // the occurrence inside the result list (<li>).
    const netCard = dialog
      .getAllByText("Net contents")
      .map((el) => el.closest("li"))
      .find(Boolean) as HTMLElement;
    fireEvent.click(within(netCard).getByRole("button", { name: /Looks correct/i }));
    // Clearing a hard CFR violation takes the deliberate confirm step, then the verdict settles.
    fireEvent.click(within(netCard).getByRole("button", { name: /Yes, mark correct/i }));
    expect(dialog.getByText("Approve")).toBeTruthy();
  });

  it("flags a matched-but-unreadable product with the clearer-image prompt, not 'no application row'", { retry: 2 }, async () => {
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
    expect(await q.findByText(/Application matched\. Upload a clearer image\./i)).toBeTruthy();
    expect(q.queryByText(/no application row/i)).toBeNull();
  });

  it("an UNREADABLE product is still reviewable: the drawer opens and a send-back is recordable", { retry: 2 }, async () => {
    // The most direct "doesn't allow me to actually review it" case: the row told the reviewer to
    // re-scan but offered nothing to click, and the drawer (had it opened) refused a decision.
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
    fireEvent.click(await q.findByRole("button", { name: /^Review$/i }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("heading", { name: /Couldn.t read this label/i })).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: /Reject \/ send back/i }));
    fireEvent.click(dialog.getByRole("button", { name: /Record decision & send email/i }));
    const stored = JSON.parse(window.localStorage.getItem("ttb-worklist-v1") ?? "{}");
    expect(Object.values(stored).some((r) => (r as { decision?: string }).decision === "reject")).toBe(true);
  });

  it("a one-off network blip SELF-HEALS via auto-retry — no manual step, no error state", { retry: 2 }, async () => {
    // First call fails, the automatic retry succeeds: the row settles to its verdict directly.
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("network down");
      return { ok: true, json: async () => RESPONSE };
    }) as unknown as typeof fetch;
    const q = await run("filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.", flaky);
    expect(await q.findByText("Approve")).toBeTruthy(); // healed without any human action
    expect(q.queryByText("Read failed")).toBeNull();
    expect(calls).toBe(2);
  });

  it("a NO-CSV product gets an honest completeness-only review with resolvable concern cards", { retry: 2 }, async () => {
    // No application values at all: the row must not read as a green wall, and the drawer must offer
    // the same confirm/flag controls as the single screen (it was reviewable in name only before).
    const incomplete = {
      ...RESPONSE,
      extracted: { ...RESPONSE.extracted, netContents: "", confidence: { ...RESPONSE.extracted.confidence, netContents: 0.9 } },
    };
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => incomplete })) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    fireEvent.change(container.querySelector('input[accept="image/*"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "acme-front.png", { type: "image/png" })] },
    });
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    expect(await q.findByText("Incomplete label")).toBeTruthy(); // attention, not a green wall
    // The no-application hint is now an INVITATION (the drawer can add values), not a dead end.
    expect(await q.findByText(/add application values in Review/i)).toBeTruthy();
    fireEvent.click(q.getByRole("button", { name: /^Review$/i }));
    const dialog = within(await screen.findByRole("dialog"));
    // Honest heading (never "Label vs. application") + a resolvable synthesized concern card.
    expect(dialog.getByText(/Label completeness \(no application values\)/i)).toBeTruthy();
    expect(screen.queryByText(/Label vs\. application/)).toBeNull();
    const netCard = dialog
      .getAllByText("Net contents")
      .map((el) => el.closest("li"))
      .find(Boolean) as HTMLElement;
    fireEvent.click(within(netCard).getByRole("button", { name: /Looks correct/i }));
    fireEvent.click(within(netCard).getByRole("button", { name: /Yes, mark correct/i }));
    // Resolving the only concern flips the suggested verdict to Approve.
    expect(dialog.getByText("Approve")).toBeTruthy();
  });

  it("renders as a list (no table), keeps the long tail in the identity stack, no standalone Complete badge", { retry: 2 }, async () => {
    const q = await run("filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.");
    expect(await q.findByText("Approve")).toBeTruthy();
    const region = q.getByRole("region", { name: /Batch extraction results/i });
    expect(within(region).getByRole("list")).toBeTruthy();
    expect(within(region).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(within(region).queryByRole("table")).toBeNull();
    // Alcohol + image count moved into the row's identity metadata; the completeness badge left the
    // list (the verdict already folds completeness in via combinedVerdict).
    expect(within(region).getByText(/40% Alc\.\/Vol\. · 1 image/)).toBeTruthy();
    expect(within(region).queryByText("Complete")).toBeNull();
    // An undecided settled row says so explicitly instead of a silent dash.
    expect(within(region).getByText("Undecided")).toBeTruthy();
  });

  it("a NO-CSV product can be given application values IN THE DRAWER and verdicts live (parity)", { retry: 2 }, async () => {
    // The dead end this feature removes: without a CSV there was no way to supply the application,
    // so the drawer could never produce a comparison verdict. Now: open Review, accept the AI's
    // suggestions as the application values, and the full Label vs. application verdict appears —
    // in the drawer, on the row badge, and persisted to the worklist.
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => RESPONSE })) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    fireEvent.change(container.querySelector('input[accept="image/*"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "acme-front.png", { type: "image/png" })] },
    });
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    expect(await q.findByText(/add application values in Review/i)).toBeTruthy();
    fireEvent.click(q.getByRole("button", { name: /^Review$/i }));
    const dialog = within(await screen.findByRole("dialog"));
    // The application section is open (no verdict yet) and offers the AI's reading.
    fireEvent.click(dialog.getByRole("button", { name: /Accept all AI suggestions/i }));
    // The comparison verdict computes live: honest heading + Approve, no page round-trip.
    expect(dialog.getByText(/Label vs\. application/)).toBeTruthy();
    expect(dialog.getByText("Approve")).toBeTruthy();
    // The typed application persists (worklist record), so a refresh resumes it.
    const stored = JSON.parse(window.localStorage.getItem("ttb-worklist-v1") ?? "{}") as Record<
      string,
      { application?: Record<string, string> }
    >;
    expect(Object.values(stored)[0]?.application?.brand).toBe("Acme");
  });

  it("editing an application value clears ALL the reviewer's stale confirm/flags (not just that field's)", { retry: 2 }, async () => {
    // Every confirm/flag was recorded against the OLD application, and comparison cards depend on
    // OTHER inputs too (the claimed class/type SELECTS the alcohol tolerance band) — a stale "ok"
    // surviving any edit could force-pass a comparison the reviewer never saw (false approval).
    const q = await run("filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.");
    expect(await q.findByText("Approve")).toBeTruthy();
    fireEvent.click(q.getByRole("button", { name: /^Review$/i }));
    const dialog = within(await screen.findByRole("dialog"));
    // Flag the (clean) brand card AND the warning card — a cross-field pair.
    const cardOf = (label: string) =>
      dialog
        .getAllByText(label)
        .map((el) => el.closest("li"))
        .find(Boolean) as HTMLElement;
    fireEvent.click(within(cardOf("Brand name")).getByRole("button", { name: /Flag a problem/i }));
    fireEvent.click(within(cardOf("Government warning")).getByRole("button", { name: /Flag a problem/i }));
    const storedAfterFlag = JSON.parse(window.localStorage.getItem("ttb-worklist-v1") ?? "{}") as Record<
      string,
      { overrides?: Record<string, string> }
    >;
    expect(Object.values(storedAfterFlag)[0]?.overrides).toEqual({ brand: "issue", warning: "issue" });
    // Edit ONE application value in the drawer: BOTH stale flags must clear.
    const summary = dialog.getByText("The application");
    fireEvent.click(summary); // expand the collapsed section (a verdict exists)
    const brandInput = dialog.getByLabelText(/^Brand name$/) as HTMLInputElement;
    fireEvent.change(brandInput, { target: { value: "Acme Reserve" } });
    const storedAfterEdit = JSON.parse(window.localStorage.getItem("ttb-worklist-v1") ?? "{}") as Record<
      string,
      { overrides?: Record<string, string>; application?: Record<string, string> }
    >;
    expect(Object.values(storedAfterEdit)[0]?.overrides).toEqual({});
    expect(Object.values(storedAfterEdit)[0]?.application?.brand).toBe("Acme Reserve");
  });

  it("the application section does NOT force-collapse on the keystroke that first completes the gate", { retry: 2 }, async () => {
    // A live-controlled <details open> would collapse around the focused input the moment the first
    // verdict computes (hiding it inside the Drawer's focus trap, mid-word). The open state is seeded
    // once per drawer open instead. Assert the DOM property directly: testing-library queries can see
    // inside a closed details, so a text query would not catch the regression.
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => RESPONSE })) as unknown as typeof fetch;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    fireEvent.change(container.querySelector('input[accept="image/*"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "acme-front.png", { type: "image/png" })] },
    });
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    await q.findByText(/add application values in Review/i);
    fireEvent.click(q.getByRole("button", { name: /^Review$/i }));
    const dialogEl = await screen.findByRole("dialog");
    const dialog = within(dialogEl);
    const details = dialogEl.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(true); // no values yet -> open
    // Filling the gate (brand + alcohol for this spirits label) computes the first verdict…
    fireEvent.change(dialog.getByLabelText(/^Brand name$/), { target: { value: "Acme" } });
    fireEvent.change(dialog.getByLabelText(/^Alcohol content$/), { target: { value: "40% Alc./Vol." } });
    expect(dialog.getByText("Approve")).toBeTruthy();
    // …and the section the reviewer is typing in stays open.
    expect(details.open).toBe(true);
  });

  it("the triage chips filter the list (Needs attention shows only attention rows)", { retry: 2 }, async () => {
    // Two products: one approves (matched CSV), one is unreadable (attention). The mock keys off
    // the uploaded image's filename so worker-pool ordering cannot flip the responses.
    const UNREADABLE: VerifyApiResponse = {
      provider: "mock",
      readable: false,
      extracted: RESPONSE.extracted,
      result: null,
      message: "Too blurry.",
    };
    const mixed = vi.fn(async (_url: string, init: { body: FormData }) => {
      const file = init.body.get("image") as File;
      return { ok: true, json: async () => (file.name.startsWith("acme") ? RESPONSE : UNREADABLE) };
    }) as unknown as typeof fetch;
    globalThis.fetch = mixed;
    const { container } = render(<BatchVerify />);
    const q = within(container);
    fireEvent.change(container.querySelector('input[accept="image/*"]') as HTMLInputElement, {
      target: { files: [new File(["x"], "acme-front.png", { type: "image/png" }), new File(["y"], "zeta-front.png", { type: "image/png" })] },
    });
    const csv = "filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.\nzeta-front.png,Zeta,40% Alc./Vol.";
    const csvFile = new File([csv], "claims.csv", { type: "text/csv" });
    Object.defineProperty(csvFile, "text", { value: () => Promise.resolve(csv) });
    fireEvent.change(q.getByLabelText(/Application values CSV/i), { target: { files: [csvFile] } });
    await q.findByText(/application row\(s\) loaded/i);
    fireEvent.click(q.getByRole("button", { name: /Read all labels/i }));
    expect(await q.findByText("Couldn't read")).toBeTruthy();
    expect(await q.findByText("Approve")).toBeTruthy();
    fireEvent.click(q.getByRole("button", { name: /Needs attention/i }));
    const region = q.getByRole("region", { name: /Batch extraction results/i });
    expect(within(region).getByText("Couldn't read")).toBeTruthy();
    expect(within(region).queryByText("Approve")).toBeNull(); // filtered out
  });
});
