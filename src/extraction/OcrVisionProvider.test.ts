/**
 * OcrVisionProvider.test.ts — Azure Document Intelligence provider with the HTTP layer
 * mocked (analyze POST -> poll GET). No live network. Asserts the request shape, that OCR text is
 * derived into ExtractedFields (with bold = null), and that missing config errors cleanly.
 */
import { describe, it, expect } from "vitest";
import {
  OcrVisionProvider,
  readAzureDocIntelConfig,
  getActiveProviders,
  type AzureDocIntelConfig,
  type FetchLike,
} from "./index";

const CONFIG: AzureDocIntelConfig = {
  endpoint: "https://example.cognitiveservices.azure.com",
  apiKey: "di-key-123",
  apiVersion: "2024-11-30",
  model: "prebuilt-read",
};

const ANALYZE_RESULT = {
  content:
    "OLD TOM DISTILLERY Kentucky Straight Bourbon Whiskey 45% Alc./Vol. (90 Proof) 750 mL " +
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages.",
  pages: [{ words: [{ confidence: 0.95 }, { confidence: 0.93 }] }],
};

function mockDIFetch() {
  const calls: { url: string; method: string; body?: string; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, body: init.body, headers: init.headers });
    if (init.method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 202,
        json: () => Promise.resolve({}),
        headers: {
          get: (n: string) =>
            n.toLowerCase() === "operation-location" ? "https://example.cognitiveservices.azure.com/op/abc" : null,
        },
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: "succeeded", analyzeResult: ANALYZE_RESULT }),
    });
  };
  return { fetchImpl, calls };
}

describe("readAzureDocIntelConfig", () => {
  it("errors cleanly listing missing env vars", () => {
    expect(() => readAzureDocIntelConfig({})).toThrow(/AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT/);
    try {
      readAzureDocIntelConfig({});
    } catch (e) {
      expect((e as Error).message).toContain("AZURE_DOCUMENT_INTELLIGENCE_KEY");
      expect((e as Error).message).toMatch(/mock/i);
    }
  });

  it("defaults api-version and model when endpoint+key are set", () => {
    const cfg = readAzureDocIntelConfig({
      AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://x.cognitiveservices.azure.com",
      AZURE_DOCUMENT_INTELLIGENCE_KEY: "k",
    });
    expect(cfg.apiVersion).toBe("2024-11-30");
    expect(cfg.model).toBe("prebuilt-read");
  });
});

describe("OcrVisionProvider.extract — Azure DI request shape + OCR field derivation", () => {
  it("submits to analyze, polls, and derives fields from the OCR text", async () => {
    const { fetchImpl, calls } = mockDIFetch();
    const provider = new OcrVisionProvider({ config: CONFIG, fetchImpl });

    const result = await provider.extract({
      filename: "label.jpg",
      data: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/jpeg",
    });

    // Request shaped for Azure Document Intelligence.
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/documentintelligence/documentModels/prebuilt-read:analyze");
    expect(calls[0].url).toContain("api-version=2024-11-30");
    expect(calls[0].headers["api-key"]).toBe("di-key-123");
    expect(JSON.parse(calls[0].body ?? "{}")).toHaveProperty("base64Source");
    expect(calls[1].method).toBe("GET"); // polled the operation-location

    // OCR text -> fields. Bold is null (OCR has no type metadata).
    expect(result.alcoholContentText).toBe("45% Alc./Vol. (90 Proof)");
    expect(result.netContents).toBe("750 mL");
    expect(result.warningText?.startsWith("GOVERNMENT WARNING")).toBe(true);
    expect(result.warningPrefixIsAllCaps).toBe(true);
    expect(result.warningPrefixIsBold).toBeNull();
    expect(result.confidence.alcoholContent).toBeCloseTo(0.94, 2);
  });

  it("flags ALL-CAPS even when the prefix wraps across lines (GOVERNMENT\\nWARNING)", async () => {
    const wrapped = {
      content:
        "Old Tom 45% Alc./Vol. 750 mL GOVERNMENT\nWARNING: (1) According to the Surgeon General, women should not drink.",
      pages: [{ words: [{ confidence: 0.9 }] }],
    };
    const fetchImpl: FetchLike = (url, init) =>
      init.method === "POST"
        ? Promise.resolve({
            ok: true,
            status: 202,
            json: () => Promise.resolve({}),
            headers: { get: (n: string) => (n.toLowerCase() === "operation-location" ? "https://example.cognitiveservices.azure.com/op/x" : null) },
          })
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "succeeded", analyzeResult: wrapped }) });
    const provider = new OcrVisionProvider({ config: CONFIG, fetchImpl });
    const result = await provider.extract({ filename: "x.jpg", data: new Uint8Array([1, 2, 3, 4]), contentType: "image/jpeg" });
    expect(result.warningText?.startsWith("GOVERNMENT WARNING")).toBe(true);
    expect(result.warningPrefixIsAllCaps).toBe(true); // wrapped caps prefix must NOT be flagged false
  });

  it("requires image bytes", async () => {
    const { fetchImpl } = mockDIFetch();
    const provider = new OcrVisionProvider({ config: CONFIG, fetchImpl });
    await expect(provider.extract({ filename: "x.jpg" })).rejects.toThrow(/image bytes/i);
  });
});

describe("getActiveProviders — ensemble", () => {
  function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const keys = Object.keys(vars);
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) {
      if (vars[k] === undefined) delete process.env[k];
      else process.env[k] = vars[k];
    }
    try {
      fn();
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  }

  it("default (mock) is a single-provider list", () => {
    withEnv({ VISION_PROVIDER: undefined }, () => {
      const ps = getActiveProviders();
      expect(ps.map((p) => p.name)).toEqual(["mock"]);
    });
  });

  it("'ensemble' runs both Azure providers in parallel (llm + ocr)", () => {
    withEnv(
      {
        AZURE_OPENAI_ENDPOINT: "https://o.openai.azure.com",
        AZURE_OPENAI_API_KEY: "k",
        AZURE_OPENAI_DEPLOYMENT: "d",
        AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://di.cognitiveservices.azure.com",
        AZURE_DOCUMENT_INTELLIGENCE_KEY: "k2",
      },
      () => {
        const ps = getActiveProviders("ensemble");
        expect(ps.map((p) => p.name).sort()).toEqual(["llm", "ocr"]);
      },
    );
  });
});
