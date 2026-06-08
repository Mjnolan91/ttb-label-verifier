/**
 * OpenAIVisionProvider.test.ts — OpenAI-direct provider with the HTTP layer mocked (no live network).
 *
 * Asserts the request is shaped for the OpenAI API (Bearer auth, model in the body, image as a data
 * URL), the response parses into ExtractedFields, missing config errors cleanly, and selecting
 * `openai` never affects the default mock/test path.
 */
import { describe, it, expect } from "vitest";
import {
  OpenAIVisionProvider,
  readOpenAIConfig,
  getVisionProvider,
  type OpenAIConfig,
  type FetchLike,
} from "./index";

const CONFIG: OpenAIConfig = { apiKey: "sk-test-123", model: "gpt-4o" };

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

describe("readOpenAIConfig", () => {
  it("errors cleanly when OPENAI_API_KEY is unset", () => {
    expect(() => readOpenAIConfig({})).toThrow(/OPENAI_API_KEY/);
    expect(() => readOpenAIConfig({})).toThrow(/mock/i);
  });

  it("defaults the model to a current multimodal model and honors OPENAI_MODEL", () => {
    expect(readOpenAIConfig({ OPENAI_API_KEY: "sk-x" }).model).toBe("gpt-4.1");
    expect(readOpenAIConfig({ OPENAI_API_KEY: "sk-x", OPENAI_MODEL: "gpt-4.1-mini" }).model).toBe(
      "gpt-4.1-mini",
    );
  });
});

describe("OpenAIVisionProvider.extract — request shape + parsing (HTTP mocked)", () => {
  it("shapes the OpenAI request and parses the response into ExtractedFields", async () => {
    const { fetchImpl, calls } = mockFetch();
    const provider = new OpenAIVisionProvider({ config: CONFIG, fetchImpl });

    const result = await provider.extract({
      filename: "label.jpg",
      data: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/jpeg",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].init.headers["authorization"]).toBe("Bearer sk-test-123");
    const body = JSON.parse(calls[0].init.body ?? "{}") as {
      model: string;
      messages: { role: string; content: unknown }[];
      response_format: { type: string };
    };
    expect(body.model).toBe("gpt-4o");
    expect(body.response_format.type).toBe("json_schema");
    const userContent = body.messages[1].content as { type: string; image_url?: { url: string } }[];
    expect(userContent.find((c) => c.type === "image_url")?.image_url?.url).toMatch(
      /^data:image\/jpeg;base64,/,
    );

    expect(result.brand).toBe("OLD TOM DISTILLERY");
    expect(result.alcoholContentText).toBe("45% Alc./Vol. (90 Proof)");
    expect(result.confidence.brand).toBeCloseTo(0.97, 5);
  });

  it("requires image bytes", async () => {
    const { fetchImpl } = mockFetch();
    const provider = new OpenAIVisionProvider({ config: CONFIG, fetchImpl });
    await expect(provider.extract({ filename: "x.jpg" })).rejects.toThrow(/image bytes/i);
  });

  it("surfaces a 401 with an actionable hint", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
    const provider = new OpenAIVisionProvider({ config: CONFIG, fetchImpl });
    await expect(
      provider.extract({ filename: "x.jpg", data: new Uint8Array([1]) }),
    ).rejects.toThrow(/401.*OPENAI_API_KEY/);
  });
});

describe("getVisionProvider('openai') — selection + offline safety", () => {
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

  it("constructs the openai provider when OPENAI_API_KEY is set", () => {
    withEnv({ OPENAI_API_KEY: "sk-x" }, () => {
      expect(getVisionProvider("openai").name).toBe("openai");
    });
  });

  it("errors cleanly when openai is selected without a key (mock path unaffected)", () => {
    withEnv({ OPENAI_API_KEY: undefined }, () => {
      expect(() => getVisionProvider("openai")).toThrow(/OPENAI_API_KEY/);
      expect(getVisionProvider().name).toBe("mock");
    });
  });
});
