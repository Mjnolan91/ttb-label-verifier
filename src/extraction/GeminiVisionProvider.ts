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
import type { ExtractOptions, ImageInput, VisionProvider } from "./VisionProvider";
import { CONFLICTING_FIELDS_DESCRIPTION, SYSTEM_PROMPT, USER_PROMPT, jointReadPreamble, parseModelJson } from "./LlmVisionProvider";
import { RESCUE_PROMPT } from "./rescue";
import { FIELD_CATALOG } from "./fieldCatalog";
import { defaultFetch, fetchWithRetry, withHardTimeout, type FetchLike } from "./http";
import { geminiTuning } from "./geminiTuning";
import { resolveWarningJudgeModel } from "./config";

// Default is a GA Flash model — stable, multimodal, fast, and broadly available (a preview "pro" id
// is fragile: it can rotate and has stricter param/quota rules). Override with GEMINI_MODEL (e.g.
// gemini-3.1-pro-preview for the most capable reads, or gemini-2.5-flash as a conservative fallback).
// Whatever you choose must support image input + structured output (responseSchema).
const DEFAULT_MODEL = "gemini-3.5-flash";

// A generous token ceiling gives headroom for a -pro model and verbose labels.
const MAX_OUTPUT_TOKENS = 4096;
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Resolved Gemini connection config. */
export interface GeminiConfig {
  apiKey: string;
  model: string;
  /** Optional model for the dedicated warning judge (WARNING_JUDGE_MODEL); defaults to `model`. */
  judgeModel?: string;
}

/**
 * Read + validate Gemini config from env. Throws an actionable error if no key is set (accepts
 * GEMINI_API_KEY or GOOGLE_API_KEY); the model defaults to a GA Flash model
 * (override with GEMINI_MODEL, e.g. gemini-3.1-pro-preview for the most capable reads).
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
  return { apiKey, model: env.GEMINI_MODEL?.trim() || DEFAULT_MODEL, judgeModel: resolveWarningJudgeModel(env) };
}

// Gemini's structured-output schema is an OpenAPI subset: UPPERCASE type names, `nullable` instead
// of a union type, no `additionalProperties`. (Same catalog-derived confidenced fields + warning flags.)
// Each field carries its catalog description so the model reads per-field rules from the schema.
const confidencedValue = (description: string) => ({
  type: "OBJECT",
  description,
  properties: { value: { type: "STRING", nullable: true }, confidence: { type: "NUMBER" } },
  required: ["value", "confidence"],
}) as const;

// Derived from the single source of truth (fieldCatalog) so this response schema can never drift from
// the field set the rest of the pipeline uses. Per-field descriptions travel with the schema.
const CONFIDENCED_FIELDS: readonly string[] = FIELD_CATALOG.map((d) => d.rawKey);

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    ...Object.fromEntries(FIELD_CATALOG.map((d) => [d.rawKey, confidencedValue(d.description)])),
    conflictingFields: {
      type: "ARRAY",
      items: { type: "STRING", enum: FIELD_CATALOG.map((d) => d.rawKey) },
      description: CONFLICTING_FIELDS_DESCRIPTION,
    },
    warningPrefixIsAllCaps: {
      type: "BOOLEAN",
      nullable: true,
      description:
        "true if the \"GOVERNMENT WARNING:\" prefix is clearly ALL CAPITAL LETTERS; false ONLY if it is clearly " +
        "title/mixed case (a real violation); null if you cannot tell. When unsure, return null — never guess.",
    },
    warningPrefixIsBold: {
      type: "BOOLEAN",
      nullable: true,
      description:
        "true if the \"GOVERNMENT WARNING:\" prefix is clearly bolder than the body text; false ONLY if it is " +
        "clearly the SAME weight as the body (a real violation); null if you cannot tell. When unsure, return " +
        "null — never guess true OR false (a wrong false rejects a compliant label).",
    },
    warningRemainderIsBold: {
      type: "BOOLEAN",
      nullable: true,
      description:
        "true ONLY if the warning statement BODY — the text AFTER the \"GOVERNMENT WARNING:\" prefix — is " +
        "clearly rendered in BOLD type (a real violation: the remainder may not appear in bold, 27 CFR " +
        "16.22(a)(2)); false if the body is clearly regular weight; null if you cannot tell. When unsure, " +
        "return null — never guess.",
    },
    warningIsReadilyLegible: {
      type: "BOOLEAN",
      nullable: true,
      description:
        "false ONLY if the warning statement is clearly HARD TO READ under ordinary conditions (ornate " +
        "script face, distorted or tiny type, poor contrast with the background); true if it reads easily; " +
        "null if you cannot tell. Italic or serif type that reads easily IS legible — never penalize style " +
        "alone.",
    },
  },
  required: [
    ...CONFIDENCED_FIELDS,
    "conflictingFields",
    "warningPrefixIsAllCaps",
    "warningPrefixIsBold",
    "warningRemainderIsBold",
    "warningIsReadilyLegible",
  ],
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

  async extract(image: ImageInput, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedFields> {
    return this.extractAll([image], signal, options);
  }

  /** The JOINT read: every image of the product in ONE request (see VisionProvider.extractAll). */
  async extractAll(images: ImageInput[], signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedFields> {
    for (const image of images) {
      if (!image.data || image.data.length === 0) {
        throw new Error("The gemini provider requires image bytes (image.data).");
      }
    }
    const url = `${API_BASE}/models/${this.config.model}:generateContent`;
    const tuning = geminiTuning(this.config.model, options?.sample ? "sample" : "read");

    const res = await fetchWithRetry(this.fetchImpl, url, {
      method: "POST",
      headers: { "x-goog-api-key": this.config.apiKey, "content-type": "application/json" },
      signal: withHardTimeout(signal),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            // Google's multimodal prompt-design guidance: the instruction prompt goes AFTER the
            // image parts; each image keeps its position hint immediately before it.
            parts: [
              ...(images.length > 1 ? [{ text: jointReadPreamble(images.length) }] : []),
              ...images.flatMap((image) => [
                ...(image.position
                  ? [{ text: `This image is the ${image.position} label of the product.` }]
                  : []),
                {
                  inlineData: {
                    mimeType: image.contentType ?? "image/jpeg",
                    data: Buffer.from(image.data!).toString("base64"),
                  },
                },
              ]),
              { text: USER_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: tuning.temperature,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          thinkingConfig: tuning.thinkingConfig,
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

  private static readonly BOLD_PROMPT =
    'Look ONLY at the government health warning statement on this label. Compare the STROKE WEIGHT ' +
    '(line thickness and darkness) of the "GOVERNMENT WARNING:" prefix against the warning body text ' +
    "that follows it. Bold means heavier strokes than the body, whatever the style: an italic, serif, " +
    "or decorative prefix still counts as BOLDER when its strokes are clearly thicker or darker than " +
    "the body. Do not penalize italics or ornate typefaces; judge stroke weight only. Answer with one " +
    "word: BOLDER, SAME, or CANNOT_DETERMINE. Use SAME only when the prefix is clearly the same weight " +
    "as the body. If there is no government warning, or the resolution or styling leaves you unsure, " +
    "answer CANNOT_DETERMINE.";

  /**
   * The judge's DEFAULT model — the strongest vision model available, NOT the extraction default.
   * The warning is the one check that can hard-fail a label, so it gets the best eyes available out
   * of the box (override with WARNING_JUDGE_MODEL; the bulk extraction reads stay on the fast model).
   * It is a preview id, so judgeWarningBold falls back to the extraction model if the call FAILS —
   * a rotated/dead id must degrade to the base model's judgment, never to "no judgment at all".
   */
  static readonly DEFAULT_JUDGE_MODEL = "gemini-3.1-pro-preview";

  async judgeWarningBold(image: ImageInput, signal?: AbortSignal): Promise<boolean | null> {
    if (!image.data || image.data.length === 0) return null;
    const base64 = Buffer.from(image.data).toString("base64");
    const judgeModel = this.config.judgeModel ?? GeminiVisionProvider.DEFAULT_JUDGE_MODEL;
    const first = await this.judgeOnce(judgeModel, base64, image.contentType, signal);
    if (first.ok || judgeModel === this.config.model) return first.verdict;
    // The judge REQUEST failed (dead preview id, 4xx/5xx, malformed reply) — not a considered
    // "cannot determine". Re-ask on the extraction model rather than dropping the judgment.
    const fallback = await this.judgeOnce(this.config.model, base64, image.contentType, signal);
    return fallback.verdict;
  }

  /** One bold-judgment call against one model. `ok` distinguishes a considered answer (incl. a
   *  legitimate CANNOT_DETERMINE -> null) from a failed request, so the caller can fall back only
   *  when the call itself failed. Never throws. */
  private async judgeOnce(
    model: string,
    base64: string,
    contentType: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; verdict: boolean | null }> {
    const url = `${API_BASE}/models/${model}:generateContent`;
    const tuning = geminiTuning(model, "bold");
    try {
      const res = await fetchWithRetry(this.fetchImpl, url, {
        method: "POST",
        headers: { "x-goog-api-key": this.config.apiKey, "content-type": "application/json" },
        signal: withHardTimeout(signal),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [
            { text: GeminiVisionProvider.BOLD_PROMPT },
            { inlineData: { mimeType: contentType ?? "image/jpeg", data: base64 } },
          ] }],
          generationConfig: {
            temperature: tuning.temperature,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
            responseSchema: { type: "OBJECT", properties: { bold: { type: "STRING", enum: ["BOLDER", "SAME", "CANNOT_DETERMINE"] } }, required: ["bold"] },
            thinkingConfig: tuning.thinkingConfig,
          },
        }),
      });
      if (!res.ok) return { ok: false, verdict: null };
      const json = (await res.json()) as GeminiResponse;
      const text = firstText(json.candidates?.[0]);
      if (!text) return { ok: false, verdict: null };
      const verdict = (JSON.parse(text) as { bold?: string }).bold;
      return { ok: true, verdict: verdict === "BOLDER" ? true : verdict === "SAME" ? false : null };
    } catch {
      return { ok: false, verdict: null };
    }
  }

  /** The low-confidence rescue pass (rescue.ts): the STRONG model re-reads only the contested
   *  fields, across all the product's images in one call. Best-effort: null on any failure (no
   *  fast-model fallback — re-asking the model that was already unsure adds nothing). */
  async readFields(
    images: ImageInput[],
    rawKeys: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, string | null> | null> {
    const usable = images.filter((img) => img.data && img.data.length > 0);
    if (usable.length === 0 || rawKeys.length === 0) return null;
    const model = this.config.judgeModel ?? GeminiVisionProvider.DEFAULT_JUDGE_MODEL;
    const url = `${API_BASE}/models/${model}:generateContent`;
    const tuning = geminiTuning(model, "read");
    const byRaw = new Map(FIELD_CATALOG.map((d) => [d.rawKey, d]));
    try {
      const res = await fetchWithRetry(this.fetchImpl, url, {
        method: "POST",
        headers: { "x-goog-api-key": this.config.apiKey, "content-type": "application/json" },
        signal: withHardTimeout(signal),
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: RESCUE_PROMPT },
                ...usable.flatMap((img) => [
                  ...(img.position ? [{ text: `This image is the ${img.position} label.` }] : []),
                  {
                    inlineData: {
                      mimeType: img.contentType ?? "image/jpeg",
                      data: Buffer.from(img.data!).toString("base64"),
                    },
                  },
                ]),
              ],
            },
          ],
          generationConfig: {
            temperature: tuning.temperature,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: Object.fromEntries(
                rawKeys.map((k) => [
                  k,
                  { type: "STRING", nullable: true, description: byRaw.get(k)?.description ?? "" },
                ]),
              ),
              required: [...rawKeys],
            },
            thinkingConfig: tuning.thinkingConfig,
          },
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as GeminiResponse;
      const text = firstText(json.candidates?.[0]);
      if (!text) return null;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const out: Record<string, string | null> = {};
      for (const k of rawKeys) {
        const v = parsed[k];
        out[k] = typeof v === "string" && v.trim() !== "" ? v.trim() : null;
      }
      return out;
    } catch {
      return null;
    }
  }
}
