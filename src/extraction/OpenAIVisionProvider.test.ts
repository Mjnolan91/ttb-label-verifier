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

describe("OpenAIVisionProvider.extract — self-consistency sampling temperature", () => {
  function bodyTemperatureOf(calls: { init: { body?: string } }[]): number {
    return (JSON.parse(calls[0].init.body ?? "{}") as { temperature: number }).temperature;
  }

  it("base read is greedy (0); a sample uses the calmer default (~0.4), not the old 0.7", async () => {
    const base = mockFetch();
    await new OpenAIVisionProvider({ config: CONFIG, fetchImpl: base.fetchImpl }).extract({
      filename: "x.jpg",
      data: new Uint8Array([1]),
    });
    expect(bodyTemperatureOf(base.calls)).toBe(0);

    const sampled = mockFetch();
    await new OpenAIVisionProvider({ config: CONFIG, fetchImpl: sampled.fetchImpl }).extract(
      { filename: "x.jpg", data: new Uint8Array([1]) },
      undefined,
      { sample: true },
    );
    const t = bodyTemperatureOf(sampled.calls);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(0.7);
    expect(t).toBeCloseTo(0.4, 5);
  });
});

describe("OpenAIVisionProvider — gpt-5/o-series param adaptation (HTTP mocked)", () => {
  const img = { filename: "x.jpg", data: new Uint8Array([1]), contentType: "image/jpeg" };
  function capture(): { fetchImpl: typeof fetch; bodies: Record<string, unknown>[] } {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "{}" } }] }) };
    }) as unknown as typeof fetch;
    return { fetchImpl, bodies };
  }

  it("a reasoning-family model gets max_completion_tokens + low effort and NO temperature/max_tokens", async () => {
    // Measured: gpt-5.5 400s on the classic params ("'max_tokens' is not supported with this model").
    const { fetchImpl, bodies } = capture();
    await new OpenAIVisionProvider({ config: { apiKey: "k", model: "gpt-5.5" }, fetchImpl }).extract(img).catch(() => {});
    const body = bodies[0];
    expect(body.max_completion_tokens).toBeGreaterThan(1500); // includes hidden-reasoning headroom
    expect(body.reasoning_effort).toBe("low");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
  });

  it("the gpt-4 line keeps the classic params", async () => {
    const { fetchImpl, bodies } = capture();
    await new OpenAIVisionProvider({ config: { apiKey: "k", model: "gpt-4.1" }, fetchImpl }).extract(img).catch(() => {});
    const body = bodies[0];
    expect(body.max_tokens).toBe(1500);
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty("max_completion_tokens");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("the bold judge adapts the same way when its model is reasoning-family", async () => {
    const { fetchImpl, bodies } = capture();
    await new OpenAIVisionProvider({ config: { apiKey: "k", model: "gpt-4.1", judgeModel: "gpt-5.5" }, fetchImpl }).judgeWarningBold!(img);
    const body = bodies[0];
    expect(body.model).toBe("gpt-5.5");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
    expect(body.max_completion_tokens).toBeGreaterThan(50);
  });

  it("OPENAI_REASONING_EFFORT raises EXTRACTION effort + headroom; the judge stays on low", async () => {
    const prev = process.env.OPENAI_REASONING_EFFORT;
    process.env.OPENAI_REASONING_EFFORT = "high";
    try {
      const { fetchImpl, bodies } = capture();
      const provider = new OpenAIVisionProvider({ config: { apiKey: "k", model: "gpt-5.5" }, fetchImpl });
      await provider.extract(img).catch(() => {});
      const extraction = bodies[0];
      expect(extraction.reasoning_effort).toBe("high");
      // A high think burns many hidden tokens; the cap must scale or the visible JSON gets starved.
      expect(extraction.max_completion_tokens as number).toBeGreaterThanOrEqual(1500 + 25000);
      await provider.judgeWarningBold!(img);
      const judge = bodies[1];
      // The judge is a 50-token binary answer on the strongest model — a long think buys nothing.
      expect(judge.reasoning_effort).toBe("low");
    } finally {
      if (prev === undefined) delete process.env.OPENAI_REASONING_EFFORT;
      else process.env.OPENAI_REASONING_EFFORT = prev;
    }
  });

  it("an invalid OPENAI_REASONING_EFFORT falls back to low", async () => {
    const prev = process.env.OPENAI_REASONING_EFFORT;
    process.env.OPENAI_REASONING_EFFORT = "maximum";
    try {
      const { fetchImpl, bodies } = capture();
      await new OpenAIVisionProvider({ config: { apiKey: "k", model: "gpt-5.5" }, fetchImpl }).extract(img).catch(() => {});
      expect(bodies[0].reasoning_effort).toBe("low");
    } finally {
      if (prev === undefined) delete process.env.OPENAI_REASONING_EFFORT;
      else process.env.OPENAI_REASONING_EFFORT = prev;
    }
  });
});

describe("OpenAIVisionProvider.judgeWarningBold — bold judgment via chat (HTTP mocked)", () => {
  it("judgeWarningBold maps the model's enum to true/false/null", async () => {
    const make = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
    const img = { filename: "x.jpg", data: new Uint8Array([1]), contentType: "image/jpeg" };
    const bolder = new OpenAIVisionProvider({ config: { apiKey: "k", model: "gpt-4.1" }, fetchImpl: (async () => make('{"bold":"BOLDER"}')) as unknown as typeof fetch });
    expect(await bolder.judgeWarningBold!(img)).toBe(true);
    const same = new OpenAIVisionProvider({ config: { apiKey: "k", model: "gpt-4.1" }, fetchImpl: (async () => make('{"bold":"SAME"}')) as unknown as typeof fetch });
    expect(await same.judgeWarningBold!(img)).toBe(false);
    const unk = new OpenAIVisionProvider({ config: { apiKey: "k", model: "gpt-4.1" }, fetchImpl: (async () => make('{"bold":"CANNOT_DETERMINE"}')) as unknown as typeof fetch });
    expect(await unk.judgeWarningBold!(img)).toBeNull();
  });

  it("the judge request NAMES the model (api.openai.com 400s without it) and honors judgeModel", async () => {
    // Regression: the shared judge body omitted `model` (fine for Azure, where the deployment is in
    // the URL) — so every OpenAI judge call failed and silently degraded to "cannot determine".
    const bodies: { model?: string }[] = [];
    const capture = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as { model?: string });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"bold":"BOLDER"}' } }] }) };
    }) as unknown as typeof fetch;
    const img = { filename: "x.jpg", data: new Uint8Array([1]), contentType: "image/jpeg" };

    // With no WARNING_JUDGE_MODEL the judge DEFAULTS to the strongest model, not the extraction
    // model — the gemini->openai provider switch must not silently downgrade the hard-fail check.
    await new OpenAIVisionProvider({ config: { apiKey: "k", model: "gpt-4.1" }, fetchImpl: capture }).judgeWarningBold!(img);
    expect(bodies[0].model).toBe(OpenAIVisionProvider.DEFAULT_JUDGE_MODEL);

    // WARNING_JUDGE_MODEL pins/overrides it.
    await new OpenAIVisionProvider({
      config: { apiKey: "k", model: "gpt-4.1", judgeModel: "gpt-5.2" },
      fetchImpl: capture,
    }).judgeWarningBold!(img);
    expect(bodies[1].model).toBe("gpt-5.2");
  });

  it("falls back to the extraction model when the strong judge call FAILS (never 'no judgment')", async () => {
    const bodies: { model?: string }[] = [];
    const failStrongThenAnswer = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { model?: string };
      bodies.push(body);
      if (body.model === OpenAIVisionProvider.DEFAULT_JUDGE_MODEL) {
        return { ok: false, status: 404, json: async () => ({ error: { message: "model not found" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"bold":"BOLDER"}' } }] }) };
    }) as unknown as typeof fetch;
    const img = { filename: "x.jpg", data: new Uint8Array([1]), contentType: "image/jpeg" };
    const verdict = await new OpenAIVisionProvider({
      config: { apiKey: "k", model: "gpt-4.1" },
      fetchImpl: failStrongThenAnswer,
    }).judgeWarningBold!(img);
    expect(verdict).toBe(true); // the fallback model's considered answer, not null
    expect(bodies.map((b) => b.model)).toEqual([OpenAIVisionProvider.DEFAULT_JUDGE_MODEL, "gpt-4.1"]);
  });

  it("does NOT fall back on a considered CANNOT_DETERMINE from the strong judge", async () => {
    const calls: string[] = [];
    const considered = (async (_url: string, init: { body: string }) => {
      calls.push((JSON.parse(init.body) as { model?: string }).model ?? "");
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"bold":"CANNOT_DETERMINE"}' } }] }) };
    }) as unknown as typeof fetch;
    const img = { filename: "x.jpg", data: new Uint8Array([1]), contentType: "image/jpeg" };
    const verdict = await new OpenAIVisionProvider({
      config: { apiKey: "k", model: "gpt-4.1" },
      fetchImpl: considered,
    }).judgeWarningBold!(img);
    expect(verdict).toBeNull();
    expect(calls).toEqual([OpenAIVisionProvider.DEFAULT_JUDGE_MODEL]); // one call, no re-ask
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
