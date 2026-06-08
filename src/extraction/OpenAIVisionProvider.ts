/**
 * OpenAIVisionProvider.ts — real multimodal extractor using the OpenAI API directly (api.openai.com).
 *
 * The pragmatic alternative to the Azure path (LlmVisionProvider): the SAME prompt, request body, and
 * JSON parsing, but pointed at OpenAI's own endpoint with a Bearer key and the model named in the body
 * (no Azure resource / quota / deployment). Selected via VISION_PROVIDER=openai. Azure (`llm`) remains
 * the in-tenant "firewall-survival" production target; this exists so a working demo isn't blocked when
 * Azure access is gated. Config from env only; the HTTP layer is injectable so unit tests use no network.
 */
import type { ExtractedFields } from "@/domain";
import type { ImageInput, VisionProvider } from "./VisionProvider";
import { SYSTEM_PROMPT, USER_PROMPT, parseModelJson, EXTRACTION_RESPONSE_FORMAT } from "./LlmVisionProvider";
import { defaultFetch, fetchWithRetry, withHardTimeout, type FetchLike } from "./http";

// A current, generally-available multimodal model (gpt-4o is the older generation and on a 2026
// retirement path). Override with OPENAI_MODEL — e.g. gpt-4.1-mini for lower cost/latency, or a
// gpt-5.x model. Whatever you choose must support image input + json_schema structured outputs.
const DEFAULT_MODEL = "gpt-4.1";
const MAX_OUTPUT_TOKENS = 1500;
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** Resolved OpenAI connection config. */
export interface OpenAIConfig {
  apiKey: string;
  model: string;
}

/**
 * Read + validate OpenAI config from env vars. Throws an actionable error if OPENAI_API_KEY is unset;
 * the model defaults to gpt-4o (override with OPENAI_MODEL).
 */
export function readOpenAIConfig(
  env: Record<string, string | undefined> = process.env,
): OpenAIConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OpenAI (VISION_PROVIDER=openai) is not configured: set OPENAI_API_KEY. " +
        "The default 'mock' provider needs no keys.",
    );
  }
  return { apiKey, model: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL };
}

/** Best-effort actionable detail for a non-OK OpenAI response. Never throws. */
async function openAIErrorDetail(res: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<string> {
  const hint =
    res.status === 401
      ? " (check OPENAI_API_KEY)"
      : res.status === 429
        ? " (rate limited or out of credit — add billing at platform.openai.com)"
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

export class OpenAIVisionProvider implements VisionProvider {
  readonly name = "openai" as const;
  private readonly config: OpenAIConfig;
  private readonly fetchImpl: FetchLike;

  constructor(opts?: { config?: OpenAIConfig; fetchImpl?: FetchLike }) {
    // Reads + validates env at construction so misconfiguration fails fast and clearly.
    this.config = opts?.config ?? readOpenAIConfig();
    this.fetchImpl = opts?.fetchImpl ?? defaultFetch;
  }

  async extract(image: ImageInput, signal?: AbortSignal): Promise<ExtractedFields> {
    if (!image.data || image.data.length === 0) {
      throw new Error("The openai provider requires image bytes (image.data).");
    }
    const base64 = Buffer.from(image.data).toString("base64");
    const dataUrl = `data:${image.contentType ?? "image/jpeg"};base64,${base64}`;

    const res = await fetchWithRetry(this.fetchImpl, OPENAI_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      signal: withHardTimeout(signal),
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              ...(image.position
                ? [{ type: "text", text: `This image is the ${image.position} label of the product.` }]
                : []),
              { type: "text", text: USER_PROMPT },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: EXTRACTION_RESPONSE_FORMAT,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI request failed with status ${res.status}${await openAIErrorDetail(res)}.`);
    }
    const json = (await res.json()) as {
      error?: { message?: string };
      choices?: { finish_reason?: string; message?: { content?: unknown } }[];
    };
    if (json.error) {
      throw new Error(`OpenAI error: ${json.error.message ?? "unknown"}.`);
    }
    const choice = json.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      throw new Error("OpenAI declined to read this image (content filter).");
    }
    if (choice?.finish_reason === "length") {
      throw new Error("OpenAI response was truncated (raise max_tokens).");
    }
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("OpenAI response did not include message content.");
    }
    return parseModelJson(content);
  }
}
