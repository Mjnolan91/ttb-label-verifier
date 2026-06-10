/**
 * LlmVisionProvider.test.ts — Azure OpenAI provider with the HTTP layer mocked.
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
import { parseModelJson, USER_PROMPT, EXTRACTION_RESPONSE_FORMAT } from "./LlmVisionProvider";
import { FIELD_CATALOG } from "./fieldCatalog";
import { FIELD_REVIEW_CONFIDENCE, MIN_READABLE_CONFIDENCE } from "@/compare";

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
    expect(body.response_format.type).toBe("json_schema");
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

  it("routes a parse-DEGRADED field (missing confidence) to review, not a confident read", () => {
    // A truncated/non-strict response can drop the confidence. Reading that at full-confidence-0 would
    // make an empty value look like a CONFIDENT absence; instead it gets a low sentinel below both the
    // review gate (0.7) and the readability floor (0.5), so it routes to human review everywhere
    // confidence is consulted — but stays > 0 so one clean field still keeps the image readable.
    const r = parseModelJson('{"brand":{"value":"X"},"warningPrefixIsAllCaps":true,"warningPrefixIsBold":null}');
    expect(r.brand).toBe("X");
    expect(r.confidence.brand).toBeGreaterThan(0);
    expect(r.confidence.brand!).toBeLessThan(MIN_READABLE_CONFIDENCE);
    expect(r.confidence.brand!).toBeLessThan(FIELD_REVIEW_CONFIDENCE);
  });

  it("treats a non-finite confidence (NaN-shaped / non-number) as degraded, not confident-0", () => {
    // confidence arrives as a string (a classic non-strict-output artifact) — not a trustworthy number.
    const r = parseModelJson('{"brand":{"value":"X","confidence":"high"},"warningPrefixIsAllCaps":true,"warningPrefixIsBold":null}');
    expect(r.confidence.brand!).toBeGreaterThan(0);
    expect(r.confidence.brand!).toBeLessThan(MIN_READABLE_CONFIDENCE);
  });

  it("does NOT degrade a genuine confident-empty read (real value+finite confidence preserved)", () => {
    // The distinction that matters: an explicit empty value WITH a finite confidence is a real
    // confident absence and must pass through untouched (it must NOT be downgraded to the sentinel).
    const r = parseModelJson('{"warningText":{"value":"","confidence":0.95},"warningPrefixIsAllCaps":false,"warningPrefixIsBold":null}');
    expect(r.warningText).toBe("");
    expect(r.confidence.warningText).toBeCloseTo(0.95, 5);
  });

  it("degrades a null-valued field that also lost its confidence (the warning present->missing flip)", () => {
    // A parse-degraded warningText (null value, no confidence) is exactly the case that used to read as
    // {value:'', confidence:0} — a confident absence that flips the completeness warning to a false
    // 'missing'. It must now carry a low (review-routing) confidence instead.
    const r = parseModelJson('{"warningText":{"value":null},"warningPrefixIsAllCaps":null,"warningPrefixIsBold":null}');
    expect(r.warningText).toBe("");
    expect(r.confidence.warningText!).toBeGreaterThan(0);
    expect(r.confidence.warningText!).toBeLessThan(FIELD_REVIEW_CONFIDENCE);
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

  it("round-trips EVERY catalog field — no rawKey is silently dropped (regression)", () => {
    // A hand-written field list here once dropped fancifulName/statementOfComposition and the two
    // supplementary 16.22 warning flags ON REAL PROVIDERS ONLY (the mock bypasses parseModelJson, so
    // the offline suite never saw it). This pins the parser to the catalog: a new field added to
    // FIELD_CATALOG automatically gets parsed, and removing one from the parser fails here.
    const payload: Record<string, unknown> = Object.fromEntries(
      FIELD_CATALOG.map((d, i) => [d.rawKey, { value: `v${i}`, confidence: 0.9 }]),
    );
    payload.warningPrefixIsAllCaps = true;
    payload.warningPrefixIsBold = true;
    payload.warningRemainderIsBold = false;
    payload.warningIsReadilyLegible = true;
    const r = parseModelJson(JSON.stringify(payload));
    const rByKey = r as unknown as Record<string, unknown>;
    for (const [i, d] of FIELD_CATALOG.entries()) {
      expect(rByKey[d.key], `value for ${d.key}`).toBe(`v${i}`);
      expect(r.confidence[d.confKey], `confidence for ${d.confKey}`).toBeCloseTo(0.9, 5);
    }
    expect(r.warningRemainderIsBold).toBe(false);
    expect(r.warningIsReadilyLegible).toBe(true);
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

  it("retries a transient 429 (honoring Retry-After) and then succeeds", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = () => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({}),
          headers: { get: (n: string) => (n.toLowerCase() === "retry-after" ? "0" : null) },
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify(MODEL_OUTPUT) } }] }),
      });
    };
    const p = new LlmVisionProvider({ config: CONFIG, fetchImpl });
    const r = await p.extract(img);
    expect(calls).toBe(2); // one retry after the 429
    expect(r.brand).toBe("OLD TOM DISTILLERY");
  });

  it("throws a clear error when the response is truncated (finish_reason = length)", async () => {
    const p = new LlmVisionProvider({
      config: CONFIG,
      fetchImpl: fetchReturning({ choices: [{ finish_reason: "length", message: { content: "{" } }] }),
    });
    await expect(p.extract(img)).rejects.toThrow(/truncated/i);
  });
});

describe("prompt + schema restructure (A3)", () => {
  it("USER_PROMPT no longer duplicates the JSON object shape", () => {
    expect(USER_PROMPT).not.toMatch(/"brand"\s*:\s*\{/);
    expect(USER_PROMPT).not.toMatch(/"confidence"\s*:\s*number/);
  });
  it("every catalog field carries a schema description (per-field instruction)", () => {
    const props = EXTRACTION_RESPONSE_FORMAT.json_schema.schema.properties as Record<string, { description?: string }>;
    expect(props.brand.description).toMatch(/transcribe/i);
    expect(props.warningText.description).toMatch(/verbatim/i);
  });
});

describe("self-consistency sampling temperature (env-tunable, calmer for verbatim transcription)", () => {
  function bodyTemperatureOf(calls: { init: { body?: string } }[]): number {
    return (JSON.parse(calls[0].init.body ?? "{}") as { temperature: number }).temperature;
  }

  it("a base (non-sample) read stays greedy at temperature 0", async () => {
    const { fetchImpl, calls } = mockFetch();
    const p = new LlmVisionProvider({ config: CONFIG, fetchImpl });
    await p.extract({ filename: "x.jpg", data: new Uint8Array([1]) });
    expect(bodyTemperatureOf(calls)).toBe(0);
  });

  it("a self-consistency SAMPLE uses the calmer default (~0.4), not the old hot 0.7", async () => {
    const { fetchImpl, calls } = mockFetch();
    const p = new LlmVisionProvider({ config: CONFIG, fetchImpl });
    await p.extract({ filename: "x.jpg", data: new Uint8Array([1]) }, undefined, { sample: true });
    const t = bodyTemperatureOf(calls);
    expect(t).toBeGreaterThan(0); // still some variance so samples can disagree where unsure
    expect(t).toBeLessThan(0.7); // but cooler than the old hardcoded value
    expect(t).toBeCloseTo(0.4, 5);
  });

  it("honors SELF_CONSISTENCY_TEMPERATURE for the sample read", async () => {
    const prev = process.env.SELF_CONSISTENCY_TEMPERATURE;
    process.env.SELF_CONSISTENCY_TEMPERATURE = "0.2";
    try {
      const { fetchImpl, calls } = mockFetch();
      const p = new LlmVisionProvider({ config: CONFIG, fetchImpl });
      await p.extract({ filename: "x.jpg", data: new Uint8Array([1]) }, undefined, { sample: true });
      expect(bodyTemperatureOf(calls)).toBeCloseTo(0.2, 5);
    } finally {
      if (prev === undefined) delete process.env.SELF_CONSISTENCY_TEMPERATURE;
      else process.env.SELF_CONSISTENCY_TEMPERATURE = prev;
    }
  });
});
