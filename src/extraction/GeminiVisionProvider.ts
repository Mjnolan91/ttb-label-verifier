/**
 * GeminiVisionProvider.ts — real multimodal extractor using Google's Gemini API
 * (generativelanguage.googleapis.com), behind the same `VisionProvider` interface as the others.
 *
 * Like the OpenAI-direct provider, this is a drop-in demo path that needs no Azure resource/quota —
 * it exists so a different frontier model can be compared head-to-head (e.g. to test whether Gemini
 * reads the government-warning bold/all-caps flags more reliably) or run in an ensemble. It reuses
 * the SAME system/user prompt and the SAME defensive JSON parser as the OpenAI/Azure providers; only
 * the request/response shape and the structured-output schema differ (Gemini's `generateContent` +
 * `responseSchema` dialect rather than chat-completions `response_format`). Config is env-only; the
 * HTTP layer is injectable so unit tests use no network.
 */
import type { ExtractedFields } from "@/domain";
import type { ImageInput, VisionProvider } from "./VisionProvider";
import { SYSTEM_PROMPT, USER_PROMPT, parseModelJson } from "./LlmVisionProvider";
import { FIELD_CATALOG } from "./fieldCatalog";
import { defaultFetch, fetchWithRetry, withHardTimeout, type FetchLike } from "./http";

// Gemini 2.x flash models were retired in 2026; the current line is the Gemini 3 series. Override
// with GEMINI_MODEL — e.g. a `-pro` model for the hardest reads (subtle visual cues like bold).
// Whatever you choose must support image input + structured output (responseSchema).
const DEFAULT_MODEL = "gemini-3.5-flash";

// Gemini 3 models "think" by default, and that reasoning is billed against maxOutputTokens AND adds
// several seconds. For a TRANSCRIPTION task (read what's printed) thinking isn't needed — measured:
// with thinking ON, the full-schema read hit MAX_TOKENS (1,242 thinking tokens) and ~8s; with
// thinkingBudget=0 it returned the complete JSON (incl. the bold/all-caps flags) in ~3s. So we
// disable it to stay inside the latency budget and avoid truncation. A generous token ceiling gives
// headroom for a -pro model (which may ignore the 0 budget and still think) and verbose labels.
const THINKING_BUDGET = 0;
const MAX_OUTPUT_TOKENS = 4096;
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Resolved Gemini connection config. */
export interface GeminiConfig {
  apiKey: string;
  model: string;
}

/**
 * Read + validate Gemini config from env. Throws an actionable error if no key is set (accepts
 * GEMINI_API_KEY or GOOGLE_API_KEY); the model defaults to a current Gemini 3 flash model
 * (override with GEMINI_MODEL).
 */
export function readGeminiConfig(
  env: Record<string, string | undefined> = process.env,
): GeminiConfig {
  const apiKey = (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY)?.trim();
  if (!apiKey) {
    throw new Error(
      "Gemini (VISION_PROVIDER=gemini) is not configured: set GEMINI_API_KEY (or GOOGLE_API_KEY). " +
        "The default 'mock' provider needs no keys.",
    );
  }
  return { apiKey, model: env.GEMINI_MODEL?.trim() || DEFAULT_MODEL };
}

// Gemini's structured-output schema is an OpenAPI subset: UPPERCASE type names, `nullable` instead
// of a union type, no `additionalProperties`. (Same 15 confidenced fields + two warning flags.)
const CONFIDENCED_VALUE = {
  type: "OBJECT",
  properties: { value: { type: "STRING" }, confidence: { type: "NUMBER" } },
  required: ["value", "confidence"],
} as const;

// Derived from the single source of truth (fieldCatalog) so this response schema can never drift from
// the field set the rest of the pipeline uses.
const CONFIDENCED_FIELDS: readonly string[] = FIELD_CATALOG.map((d) => d.rawKey);

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    ...Object.fromEntries(CONFIDENCED_FIELDS.map((f) => [f, CONFIDENCED_VALUE])),
    warningPrefixIsAllCaps: { type: "BOOLEAN" },
    warningPrefixIsBold: { type: "BOOLEAN", nullable: true },
  },
  required: [...CONFIDENCED_FIELDS, "warningPrefixIsAllCaps", "warningPrefixIsBold"],
} as const;

/** Best-effort actionable detail for a non-OK Gemini response. Never throws. */
async function geminiErrorDetail(res: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<string> {
  const hint =
    res.status === 400 || res.status === 401 || res.status === 403
      ? " (check GEMINI_API_KEY / GOOGLE_API_KEY and that the model supports image + structured output)"
      : res.status === 429
        ? " (rate limited or out of quota — check your Google AI Studio quota)"
        : "";
  let message = "";
  try {
    const body = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      const err = (body as { error?: { message?: string } }).error;
      if (err?.message) message = `: ${err.message}`;
    }
  } catch {
    // Body wasn't JSON — status + hint is enough.
  }
  return `${message}${hint}`;
}

interface GeminiResponse {
  error?: { message?: string };
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: unknown }[] };
  }[];
}

/** The first text part of a candidate's content (where the JSON payload lives). */
function firstText(candidate: NonNullable<GeminiResponse["candidates"]>[number] | undefined): string | undefined {
  const parts = candidate?.content?.parts ?? [];
  for (const p of parts) {
    if (typeof p.text === "string" && p.text.trim() !== "") return p.text;
  }
  return undefined;
}

export class GeminiVisionProvider implements VisionProvider {
  readonly name = "gemini" as const;
  private readonly config: GeminiConfig;
  private readonly fetchImpl: FetchLike;

  constructor(opts?: { config?: GeminiConfig; fetchImpl?: FetchLike }) {
    // Reads + validates env at construction so misconfiguration fails fast and clearly.
    this.config = opts?.config ?? readGeminiConfig();
    this.fetchImpl = opts?.fetchImpl ?? defaultFetch;
  }

  async extract(image: ImageInput, signal?: AbortSignal): Promise<ExtractedFields> {
    if (!image.data || image.data.length === 0) {
      throw new Error("The gemini provider requires image bytes (image.data).");
    }
    const base64 = Buffer.from(image.data).toString("base64");
    const url = `${API_BASE}/models/${this.config.model}:generateContent`;

    const res = await fetchWithRetry(this.fetchImpl, url, {
      method: "POST",
      headers: { "x-goog-api-key": this.config.apiKey, "content-type": "application/json" },
      signal: withHardTimeout(signal),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              ...(image.position
                ? [{ text: `This image is the ${image.position} label of the product.` }]
                : []),
              { text: USER_PROMPT },
              { inlineData: { mimeType: image.contentType ?? "image/jpeg", data: base64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          thinkingConfig: { thinkingBudget: THINKING_BUDGET },
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Gemini request failed with status ${res.status}${await geminiErrorDetail(res)}.`);
    }
    const json = (await res.json()) as GeminiResponse;
    if (json.error) {
      throw new Error(`Gemini error: ${json.error.message ?? "unknown"}.`);
    }
    const candidate = json.candidates?.[0];
    const finish = candidate?.finishReason;
    if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST") {
      throw new Error("Gemini declined to read this image (safety filter).");
    }
    if (finish === "MAX_TOKENS") {
      throw new Error("Gemini response was truncated (raise maxOutputTokens).");
    }
    const content = firstText(candidate);
    if (content === undefined) {
      throw new Error("Gemini response did not include any text content.");
    }
    return parseModelJson(content);
  }
}
