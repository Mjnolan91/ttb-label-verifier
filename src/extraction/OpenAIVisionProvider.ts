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
import type { ExtractOptions, ImageInput, VisionProvider } from "./VisionProvider";
import { buildExtractionBody, callChatCompletion, judgeWarningBoldViaChat } from "./LlmVisionProvider";
import { defaultFetch, type FetchLike } from "./http";
import { resolveSelfConsistencyTemperature, resolveWarningJudgeModel } from "./config";

// A current, generally-available multimodal model (gpt-4o is the older generation and on a 2026
// retirement path). Override with OPENAI_MODEL — e.g. gpt-4.1-mini for lower cost/latency, or a
// gpt-5.x model. Whatever you choose must support image input + json_schema structured outputs.
const DEFAULT_MODEL = "gpt-4.1";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** Resolved OpenAI connection config. */
export interface OpenAIConfig {
  apiKey: string;
  model: string;
  /** Optional model for the dedicated warning judge (WARNING_JUDGE_MODEL); defaults to `model`. */
  judgeModel?: string;
}

/**
 * Read + validate OpenAI config from env vars. Throws an actionable error if OPENAI_API_KEY is unset;
 * the model defaults to DEFAULT_MODEL (gpt-4.1; override with OPENAI_MODEL).
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
  return { apiKey, model: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL, judgeModel: resolveWarningJudgeModel(env) };
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

  async extract(image: ImageInput, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedFields> {
    if (!image.data || image.data.length === 0) {
      throw new Error("The openai provider requires image bytes (image.data).");
    }
    const dataUrl = `data:${image.contentType ?? "image/jpeg"};base64,${Buffer.from(image.data).toString("base64")}`;
    // Base read is greedy (0); a self-consistency SAMPLE uses the env-tunable sampling temperature
    // (default ~0.4) — shared with the Azure chat path via config so both stay tuned in one place.
    const temperature = options?.sample ? resolveSelfConsistencyTemperature() : 0;

    return callChatCompletion({
      fetchImpl: this.fetchImpl,
      url: OPENAI_URL,
      headers: { authorization: `Bearer ${this.config.apiKey}` },
      body: buildExtractionBody(image, dataUrl, { model: this.config.model }, temperature),
      label: "OpenAI",
      hintFor: (status) =>
        status === 401
          ? " (check OPENAI_API_KEY)"
          : status === 429
            ? " (rate limited or out of credit — add billing at platform.openai.com)"
            : "",
      signal,
    });
  }

  async judgeWarningBold(image: ImageInput, signal?: AbortSignal): Promise<boolean | null> {
    if (!image.data || image.data.length === 0) return null;
    const dataUrl = `data:${image.contentType ?? "image/jpeg"};base64,${Buffer.from(image.data).toString("base64")}`;
    // api.openai.com REQUIRES the model in the body (Azure names a deployment in the URL instead) —
    // without it the judge 400s and silently degrades to "cannot determine" on every call. The judge
    // can also run on a stronger model than extraction via WARNING_JUDGE_MODEL.
    return judgeWarningBoldViaChat({
      fetchImpl: this.fetchImpl,
      url: OPENAI_URL,
      headers: { authorization: `Bearer ${this.config.apiKey}` },
      dataUrl,
      signal,
      model: this.config.judgeModel ?? this.config.model,
    });
  }
}
