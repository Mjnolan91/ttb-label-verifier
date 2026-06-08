/**
 * LlmVisionProvider.test.ts (US-009) — Azure OpenAI provider with the HTTP layer mocked.
 *
 * No live network: a fake FetchLike captures the request and returns a canned Azure response.
 * Asserts the request is shaped for Azure OpenAI, the response parses into ExtractedFields, and a
 * missing-config case errors cleanly. Also confirms selecting llm never affects the mock/test path.
 */
import { describe, it, expect } from "vitest";
import {
  LlmVisionProvider,
  readAzureOpenAIConfig,
  getVisionProvider,
  type AzureOpenAIConfig,
  type FetchLike,
} from "./index";
import { parseModelJson } from "./LlmVisionProvider";

/** A FetchLike that returns one canned Azure chat-completions payload (no network). */
function fetchReturning(payload: unknown, ok = true, status = 200): FetchLike {
  return () => Promise.resolve({ ok, status, json: () => Promise.resolve(payload) });
}
/** Shorthand: an Azure 200 whose message content is the given string. */
function fetchWithContent(content: string): FetchLike {
  return fetchReturning({ choices: [{ message: { content } }] });
}

const CONFIG: AzureOpenAIConfig = {
  endpoint: "https://example.openai.azure.com",
  apiKey: "test-key-123",
  deployment: "gpt-4o-vision",
  apiVersion: "2024-10-21",
};

const MODEL_OUTPUT = {
  brand: { value: "OLD TOM DISTILLERY", confidence: 0.97 },
  classType: { value: "Kentucky Straight Bourbon Whiskey", confidence: 0.95 },
  alcoholContent: { value: "45% Alc./Vol. (90 Proof)", confidence: 0.96 },
  netContents: { value: "750 mL", confidence: 0.94 },
  warningText: { value: "GOVERNMENT WARNING: ...", confidence: 0.96 },
  warningPrefixIsAllCaps: true,
  warningPrefixIsBold: true,
};

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
      json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify(MODEL_OUTPUT) } }] }),
    });
  };
  return { fetchImpl, calls };
}

describe("readAzureOpenAIConfig", () => {
  it("errors cleanly listing every missing env var", () => {
    expect(() => readAzureOpenAIConfig({})).toThrow(/AZURE_OPENAI_ENDPOINT/);
    try {
      readAzureOpenAIConfig({});
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("AZURE_OPENAI_API_KEY");
      expect(msg).toContain("AZURE_OPENAI_DEPLOYMENT");
      expect(msg).toMatch(/mock/i); // points the user back to the offline default
    }
  });

  it("defaults the optional api-version when the rest are set", () => {
    const cfg = readAzureOpenAIConfig({
      AZURE_OPENAI_ENDPOINT: "https://x.openai.azure.com",
      AZURE_OPENAI_API_KEY: "k",
      AZURE_OPENAI_DEPLOYMENT: "d",
    });
    expect(cfg.apiVersion).toBe("2024-10-21");
    expect(cfg.endpoint).toBe("https://x.openai.azure.com");
  });
});

describe("LlmVisionProvider.extract — request shape + parsing (HTTP mocked)", () => {
  it("shapes the Azure OpenAI request and parses the response into ExtractedFields", async () => {
    const { fetchImpl, calls } = mockFetch();
    const provider = new LlmVisionProvider({ config: CONFIG, fetchImpl });

    const result = await provider.extract({
      filename: "label.jpg",
      data: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/jpeg",
    });

    // Request shaped for Azure OpenAI.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/openai/deployments/gpt-4o-vision/chat/completions");
    expect(calls[0].url).toContain("api-version=2024-10-21");
    expect(calls[0].init.headers["api-key"]).toBe("test-key-123");
    const body = JSON.parse(calls[0].init.body ?? "{}") as {
      messages: { role: string; content: unknown }[];
      response_format: { type: string };
    };
    expect(body.response_format.type).toBe("json_object");
    const userContent = body.messages[1].content as { type: string; image_url?: { url: string } }[];
    const imagePart = userContent.find((c) => c.type === "image_url");
    expect(imagePart?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);

    // Response parsed into ExtractedFields with per-field confidence.
    expect(result.brand).toBe("OLD TOM DISTILLERY");
    expect(result.alcoholContentText).toBe("45% Alc./Vol. (90 Proof)");
    expect(result.warningPrefixIsAllCaps).toBe(true);
    expect(result.warningPrefixIsBold).toBe(true);
    expect(result.confidence.brand).toBeCloseTo(0.97, 5);
  });

  it("includes a label-position hint in the request when the image has a position", async () => {
    const { fetchImpl, calls } = mockFetch();
    const provider = new LlmVisionProvider({ config: CONFIG, fetchImpl });
    await provider.extract({ filename: "back.jpg", data: new Uint8Array([1]), position: "back" });
    expect(calls[0].init.body).toContain("back label");
  });

  it("requires image bytes", async () => {
    const { fetchImpl } = mockFetch();
    const provider = new LlmVisionProvider({ config: CONFIG, fetchImpl });
    await expect(provider.extract({ filename: "x.jpg" })).rejects.toThrow(/image bytes/i);
  });

  it("throws on a non-OK HTTP status", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
    const provider = new LlmVisionProvider({ config: CONFIG, fetchImpl });
    await expect(
      provider.extract({ filename: "x.jpg", data: new Uint8Array([1]) }),
    ).rejects.toThrow(/401/);
  });
});

describe("getVisionProvider('llm') — selection + offline safety", () => {
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

  it("constructs the llm provider when env is configured", () => {
    withEnv(
      {
        AZURE_OPENAI_ENDPOINT: "https://x.openai.azure.com",
        AZURE_OPENAI_API_KEY: "k",
        AZURE_OPENAI_DEPLOYMENT: "d",
      },
      () => {
        const p = getVisionProvider("llm");
        expect(p.name).toBe("llm");
      },
    );
  });

  it("errors cleanly when llm is selected without config (mock/test path unaffected)", () => {
    withEnv(
      {
        AZURE_OPENAI_ENDPOINT: undefined,
        AZURE_OPENAI_API_KEY: undefined,
        AZURE_OPENAI_DEPLOYMENT: undefined,
      },
      () => {
        expect(() => getVisionProvider("llm")).toThrow(/not configured|AZURE_OPENAI/i);
        // The default stays mock and is always available.
        expect(getVisionProvider().name).toBe("mock");
      },
    );
  });
});

describe("parseModelJson — robust parsing (offline)", () => {
  it("recovers JSON wrapped in ```json code fences", () => {
    const r = parseModelJson('```json\n{"warningPrefixIsAllCaps":true,"warningPrefixIsBold":null}\n```');
    expect(r.warningPrefixIsAllCaps).toBe(true);
    expect(r.warningPrefixIsBold).toBeNull();
  });

  it("recovers the first balanced object from surrounding prose", () => {
    const r = parseModelJson(
      'Here is the JSON: {"brand":{"value":"X","confidence":0.9},' +
        '"warningPrefixIsAllCaps":false,"warningPrefixIsBold":false} — done.',
    );
    expect(r.brand).toBe("X");
    expect(r.confidence.brand).toBeCloseTo(0.9, 5);
  });

  it("throws when there is no JSON object at all", () => {
    expect(() => parseModelJson("no json here, sorry")).toThrow(/not valid JSON/i);
  });

  it("defaults a missing per-field confidence to 0 (routes to review, never auto-approve)", () => {
    const r = parseModelJson('{"brand":{"value":"X"},"warningPrefixIsAllCaps":true,"warningPrefixIsBold":null}');
    expect(r.brand).toBe("X");
    expect(r.confidence.brand).toBe(0);
  });

  it("coerces a non-boolean warningPrefixIsBold to null (never guesses true)", () => {
    expect(
      parseModelJson('{"warningPrefixIsAllCaps":true,"warningPrefixIsBold":"true"}').warningPrefixIsBold,
    ).toBeNull();
    expect(parseModelJson('{"warningPrefixIsAllCaps":true}').warningPrefixIsBold).toBeNull();
  });

  it("preserves a high-confidence empty warningText (confidently absent, not unreadable)", () => {
    const r = parseModelJson(
      '{"warningText":{"value":"","confidence":0.95},"warningPrefixIsAllCaps":false,"warningPrefixIsBold":null}',
    );
    expect(r.warningText).toBe("");
    expect(r.confidence.warningText).toBeCloseTo(0.95, 5);
  });
});

describe("LlmVisionProvider.extract — error/refusal handling (HTTP mocked)", () => {
  const img = { filename: "x.jpg", data: new Uint8Array([1, 2, 3]) };

  it("recovers a fenced JSON response end-to-end", async () => {
    const p = new LlmVisionProvider({
      config: CONFIG,
      fetchImpl: fetchWithContent("```json\n" + JSON.stringify(MODEL_OUTPUT) + "\n```"),
    });
    const r = await p.extract(img);
    expect(r.brand).toBe("OLD TOM DISTILLERY");
  });

  it("throws a distinct error when the content filter blocks the image", async () => {
    const p = new LlmVisionProvider({
      config: CONFIG,
      fetchImpl: fetchReturning({
        choices: [{ finish_reason: "content_filter", message: { content: null } }],
      }),
    });
    await expect(p.extract(img)).rejects.toThrow(/content filter/i);
  });

  it("surfaces a structured Azure error message on a non-OK status", async () => {
    const p = new LlmVisionProvider({
      config: CONFIG,
      fetchImpl: fetchReturning({ error: { message: "Deployment not found" } }, false, 404),
    });
    await expect(p.extract(img)).rejects.toThrow(/404.*Deployment not found/i);
  });

  it("hints at the API key on a 401", async () => {
    const p = new LlmVisionProvider({ config: CONFIG, fetchImpl: fetchReturning({}, false, 401) });
    await expect(p.extract(img)).rejects.toThrow(/AZURE_OPENAI_API_KEY/);
  });

  it("throws when the response has empty message content", async () => {
    const p = new LlmVisionProvider({ config: CONFIG, fetchImpl: fetchWithContent("   ") });
    await expect(p.extract(img)).rejects.toThrow(/message content/i);
  });

  it("surfaces a top-level error object returned with HTTP 200", async () => {
    const p = new LlmVisionProvider({
      config: CONFIG,
      fetchImpl: fetchReturning({ error: { message: "quota exceeded", code: "429" } }),
    });
    await expect(p.extract(img)).rejects.toThrow(/quota exceeded/i);
  });
});
