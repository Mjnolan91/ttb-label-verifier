/**
 * GeminiVisionProvider.test.ts — Google Gemini provider with the HTTP layer mocked (no live network).
 *
 * Asserts the request is shaped for the Gemini generateContent API (x-goog-api-key, inline image
 * data, a responseSchema for structured output), the response parses into ExtractedFields, missing
 * config errors cleanly, truncation/safety finish reasons are surfaced, and selecting `gemini` never
 * affects the default mock/test path.
 */
import { describe, it, expect } from "vitest";
import {
  GeminiVisionProvider,
  readGeminiConfig,
  getVisionProvider,
  type GeminiConfig,
  type FetchLike,
} from "./index";

const CONFIG: GeminiConfig = { apiKey: "AIza-test-123", model: "gemini-3.5-flash" };

const MODEL_OUTPUT = {
  brand: { value: "OLD TOM DISTILLERY", confidence: 0.97 },
  classType: { value: "Kentucky Straight Bourbon Whiskey", confidence: 0.95 },
  alcoholContent: { value: "45% Alc./Vol. (90 Proof)", confidence: 0.96 },
  netContents: { value: "750 mL", confidence: 0.94 },
  warningText: { value: "GOVERNMENT WARNING: ...", confidence: 0.96 },
  warningPrefixIsAllCaps: true,
  warningPrefixIsBold: true,
};

/** A Gemini 200 whose first candidate part carries the given text. */
function fetchWithText(text: string, ok = true, status = 200): FetchLike {
  return () =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }),
    });
}

function mockFetch(): {
  fetchImpl: FetchLike;
  calls: { url: string; init: { headers: Record<string, string>; body?: string } }[];
} {
  const calls: { url: string; init: { headers: Record<string, string>; body?: string } }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(MODEL_OUTPUT) }] } }],
        }),
    });
  };
  return { fetchImpl, calls };
}

describe("readGeminiConfig", () => {
  it("errors cleanly when no key is set, pointing back to the mock default", () => {
    expect(() => readGeminiConfig({})).toThrow(/GEMINI_API_KEY/);
    expect(() => readGeminiConfig({})).toThrow(/mock/i);
  });

  it("accepts GEMINI_API_KEY or GOOGLE_API_KEY and honors GEMINI_MODEL", () => {
    expect(readGeminiConfig({ GEMINI_API_KEY: "k" }).model).toBe("gemini-3.5-flash");
    expect(readGeminiConfig({ GOOGLE_API_KEY: "k" }).apiKey).toBe("k");
    expect(readGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-3.1-pro-preview" }).model).toBe(
      "gemini-3.1-pro-preview",
    );
  });
});

describe("GeminiVisionProvider.extract — request shape + parsing (HTTP mocked)", () => {
  it("shapes the Gemini request and parses the response into ExtractedFields", async () => {
    const { fetchImpl, calls } = mockFetch();
    const provider = new GeminiVisionProvider({ config: CONFIG, fetchImpl });

    const result = await provider.extract({
      filename: "label.jpg",
      data: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/jpeg",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/models/gemini-3.5-flash:generateContent");
    expect(calls[0].init.headers["x-goog-api-key"]).toBe("AIza-test-123");
    const body = JSON.parse(calls[0].init.body ?? "{}") as {
      contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[];
      generationConfig: { responseMimeType: string; responseSchema?: unknown; thinkingConfig?: { thinkingBudget?: number } };
    };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toBeTruthy();
    // Gemini 3 uses thinkingLevel:"low" (not thinkingBudget, and NOT "minimal" — Pro rejects that)
    // — keeps latency inside budget while staying correct for the gen3 API.
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    const inline = body.contents[0].parts.find((p) => p.inlineData)?.inlineData;
    expect(inline?.mimeType).toBe("image/jpeg");
    expect(typeof inline?.data).toBe("string");

    expect(result.brand).toBe("OLD TOM DISTILLERY");
    expect(result.alcoholContentText).toBe("45% Alc./Vol. (90 Proof)");
    expect(result.warningPrefixIsBold).toBe(true);
    expect(result.confidence.brand).toBeCloseTo(0.97, 5);
  });

  it("includes a label-position hint when the image has a position", async () => {
    const { fetchImpl, calls } = mockFetch();
    const provider = new GeminiVisionProvider({ config: CONFIG, fetchImpl });
    await provider.extract({ filename: "back.jpg", data: new Uint8Array([1]), position: "back" });
    expect(calls[0].init.body).toContain("back label");
  });

  it("requires image bytes", async () => {
    const { fetchImpl } = mockFetch();
    const provider = new GeminiVisionProvider({ config: CONFIG, fetchImpl });
    await expect(provider.extract({ filename: "x.jpg" })).rejects.toThrow(/image bytes/i);
  });

  it("surfaces a non-OK status with an actionable hint", async () => {
    const provider = new GeminiVisionProvider({
      config: CONFIG,
      fetchImpl: () =>
        Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: { message: "bad key" } }) }),
    });
    await expect(
      provider.extract({ filename: "x.jpg", data: new Uint8Array([1]) }),
    ).rejects.toThrow(/400.*bad key/i);
  });

  it("throws on a truncated (MAX_TOKENS) response", async () => {
    const provider = new GeminiVisionProvider({
      config: CONFIG,
      fetchImpl: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] }),
        }),
    });
    await expect(
      provider.extract({ filename: "x.jpg", data: new Uint8Array([1]) }),
    ).rejects.toThrow(/truncated/i);
  });

  it("throws a distinct error when the safety filter blocks the image", async () => {
    const provider = new GeminiVisionProvider({ config: CONFIG, fetchImpl: fetchWithText("", true, 200) });
    // fetchWithText returns finishReason STOP with empty text -> "no text content"; build a SAFETY one inline.
    const blocked = new GeminiVisionProvider({
      config: CONFIG,
      fetchImpl: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }),
        }),
    });
    await expect(blocked.extract({ filename: "x.jpg", data: new Uint8Array([1]) })).rejects.toThrow(/safety/i);
    await expect(provider.extract({ filename: "x.jpg", data: new Uint8Array([1]) })).rejects.toThrow(/text content/i);
  });
});

describe("GeminiVisionProvider — bold pass + tuning", () => {
  function fetchReturning(text: string) {
    return (async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) })) as unknown as typeof fetch;
  }
  const img = { filename: "x.jpg", data: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };
  const cfg = { apiKey: "k", model: "gemini-3.1-pro-preview" };

  it("judgeWarningBold maps BOLDER/SAME/CANNOT_DETERMINE to true/false/null", async () => {
    const bolder = new GeminiVisionProvider({ config: cfg, fetchImpl: fetchReturning('{"bold":"BOLDER"}') });
    expect(await bolder.judgeWarningBold!(img)).toBe(true);
    const same = new GeminiVisionProvider({ config: cfg, fetchImpl: fetchReturning('{"bold":"SAME"}') });
    expect(await same.judgeWarningBold!(img)).toBe(false);
    const unk = new GeminiVisionProvider({ config: cfg, fetchImpl: fetchReturning('{"bold":"CANNOT_DETERMINE"}') });
    expect(await unk.judgeWarningBold!(img)).toBeNull();
  });

  it("the judge runs on judgeModel (WARNING_JUDGE_MODEL) when set, while extraction keeps the base model", async () => {
    // The warning judge is the one call that can hard-fail a label, so it may run on a stronger
    // (slower) model than the bulk extraction reads.
    const urls: string[] = [];
    const capture = (async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"bold":"BOLDER"}' }] } }] }) };
    }) as unknown as typeof fetch;
    const p = new GeminiVisionProvider({
      config: { apiKey: "k", model: "gemini-3.5-flash", judgeModel: "gemini-3.1-pro-preview" },
      fetchImpl: capture,
    });
    expect(await p.judgeWarningBold!(img)).toBe(true);
    expect(urls[0]).toContain("gemini-3.1-pro-preview");
    expect(urls[0]).not.toContain("gemini-3.5-flash");
  });

  it("the read request carries gen3 thinkingLevel 'low' and sends NO per-part mediaResolution (v1beta-unsupported)", async () => {
    type CapturedPart = { text?: string; inlineData?: unknown; mediaResolution?: unknown };
    type CapturedBody = {
      generationConfig: { temperature: number; thinkingConfig: unknown };
      contents: { parts: CapturedPart[] }[];
    };
    let body: CapturedBody;
    const capture = (async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body) as CapturedBody;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }) };
    }) as unknown as typeof fetch;
    await new GeminiVisionProvider({ config: cfg, fetchImpl: capture }).extract(img);
    expect(body!.generationConfig.temperature).toBe(1);
    expect(body!.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    const mediaPart = body!.contents[0].parts.find((p) => p.inlineData);
    expect(mediaPart?.mediaResolution).toBeUndefined();
  });
});

describe("getVisionProvider('gemini') — selection + offline safety", () => {
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

  it("constructs the gemini provider when a key is set (and via the 'google' alias)", () => {
    withEnv({ GEMINI_API_KEY: "k", GOOGLE_API_KEY: undefined }, () => {
      expect(getVisionProvider("gemini").name).toBe("gemini");
      expect(getVisionProvider("google").name).toBe("gemini");
    });
  });

  it("errors cleanly when gemini is selected without a key (mock path unaffected)", () => {
    withEnv({ GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined }, () => {
      expect(() => getVisionProvider("gemini")).toThrow(/GEMINI_API_KEY/);
      expect(getVisionProvider().name).toBe("mock");
    });
  });
});
