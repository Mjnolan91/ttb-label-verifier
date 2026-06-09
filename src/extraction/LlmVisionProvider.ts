/**
 * LlmVisionProvider.ts — real fast-tier multimodal extractor.
 *
 * The reference implementation targets **Azure OpenAI** (a vision-capable chat deployment). This
 * is the in-tenant "firewall-survival" path: it runs inside the Azure tenant rather than calling a
 * third-party ML endpoint the outbound firewall would block. The VisionProvider interface stays
 * generic — only this concrete class is Azure-specific.
 *
 * Config is read from environment variables ONLY (no secrets in code). Selecting this provider
 * without the required vars errors with an actionable message; the default `mock` provider needs
 * no keys, so dev and the entire test suite are unaffected. The HTTP layer is injectable so unit
 * tests run with no live network.
 */
import type { ExtractedFields } from "@/domain";
import type { ExtractOptions, ImageInput, VisionProvider } from "./VisionProvider";
import {
  mapRawExtracted,
  type RawConfidencedValue,
  type RawExtractedFields,
} from "./extractedShape";
import { FIELD_CATALOG } from "./fieldCatalog";
import { defaultFetch, fetchWithRetry, withHardTimeout, type FetchLike } from "./http";

/** Resolved Azure OpenAI connection config. */
export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

const DEFAULT_API_VERSION = "2024-10-21";

/**
 * Completion-token ceiling. Generous because the full verbatim government warning (~30+ words) plus
 * 15 confidenced fields must fit; truncation is detected explicitly (finish_reason === "length")
 * rather than surfacing as a confusing JSON parse error.
 */
const MAX_OUTPUT_TOKENS = 1500;

/**
 * Strict Structured Outputs schema (the 15 confidenced fields + the two warning flags). Sent as
 * `response_format: json_schema` so the model is CONSTRAINED to this exact shape — eliminating the
 * class of silent malformed-output bugs that loose json_object mode allows. parseModelJson remains a
 * thin defensive guard for any provider/api-version that doesn't honor the constraint. Supported on
 * the default Azure api-version (2024-10-21) and on gpt-4o-2024-08-06+ / gpt-4.1 / gpt-5.x.
 *
 * Each field's schema object carries the catalog `description` so the model reads per-field rules
 * directly from the schema rather than from duplicated prose in the USER_PROMPT (Google research
 * shows duplicating the shape in the prompt lowers output quality). Value is nullable so the model
 * can signal "not present" without returning an empty string with low confidence.
 */
function confidencedValueSchema(description: string) {
  return {
    type: "object",
    description,
    properties: { value: { type: ["string", "null"] }, confidence: { type: "number" } },
    required: ["value", "confidence"],
    additionalProperties: false,
  } as const;
}

// Derived from the single source of truth (fieldCatalog) so the strict-output schema can never drift
// from the field set the mapper/merge/UI/CSV use. Per-field descriptions travel with the schema.
const CONFIDENCED_FIELDS: readonly string[] = FIELD_CATALOG.map((d) => d.rawKey);

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    ...Object.fromEntries(FIELD_CATALOG.map((d) => [d.rawKey, confidencedValueSchema(d.description)])),
    warningPrefixIsAllCaps: {
      type: ["boolean", "null"],
      description:
        "true if the \"GOVERNMENT WARNING:\" prefix is clearly ALL CAPITAL LETTERS; false ONLY if it is " +
        "clearly title/mixed case (a real violation); null if you cannot tell. When unsure, return null — " +
        "never guess (a wrong false rejects a compliant label).",
    },
    warningPrefixIsBold: {
      type: ["boolean", "null"],
      description:
        "true if the \"GOVERNMENT WARNING:\" prefix is clearly bolder than the body text; false ONLY if it is " +
        "clearly the SAME weight as the body (a real violation); null if you cannot tell. When unsure, return " +
        "null — never guess true OR false (a wrong false rejects a compliant label).",
    },
  },
  required: [...CONFIDENCED_FIELDS, "warningPrefixIsAllCaps", "warningPrefixIsBold"],
  additionalProperties: false,
} as const;

/** The Chat Completions `response_format` requesting strict structured output to the schema above. */
export const EXTRACTION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: { name: "ttb_label_fields", strict: true, schema: EXTRACTION_JSON_SCHEMA },
} as const;

/**
 * Read + validate Azure OpenAI config from env vars. Throws an actionable error listing any that
 * are unset. Defaults the optional api-version.
 */
export function readAzureOpenAIConfig(
  env: Record<string, string | undefined> = process.env,
): AzureOpenAIConfig {
  const endpoint = env.AZURE_OPENAI_ENDPOINT?.trim();
  const apiKey = env.AZURE_OPENAI_API_KEY?.trim();
  const deployment = env.AZURE_OPENAI_DEPLOYMENT?.trim();
  const apiVersion = env.AZURE_OPENAI_API_VERSION?.trim() || DEFAULT_API_VERSION;

  if (!endpoint || !apiKey || !deployment) {
    const missing: string[] = [];
    if (!endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
    if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
    if (!deployment) missing.push("AZURE_OPENAI_DEPLOYMENT");
    throw new Error(
      `Azure OpenAI (VISION_PROVIDER=llm) is not configured: set ${missing.join(", ")}. ` +
        "The default 'mock' provider needs no keys.",
    );
  }
  return { endpoint, apiKey, deployment, apiVersion };
}

export const SYSTEM_PROMPT =
  "You are a meticulous compliance assistant that TRANSCRIBES U.S. TTB alcohol-beverage labels for " +
  "verification. You read text from the image — you never judge compliance. This output is used by a " +
  "government reviewer, so precision about WHICH words belong in WHICH field matters as much as legibility. " +
  "Hard rules:\n" +
  "1. Transcribe ONLY text actually printed on the label in the image.\n" +
  "2. NEVER guess, infer, autocomplete, translate, or correct text, and NEVER add a word that is not " +
  'printed (do not invent "Spiced", "Reserve", "Aged", etc.). If a field is not legibly present, return "" ' +
  "for its value and a LOW confidence (<= 0.3).\n" +
  "3. Report per-field confidence in [0,1] honestly, reflecting both how legible the text is AND how sure " +
  "you are the words belong in that field; when unsure which field a word belongs to, lower the confidence.\n" +
  "4. TTB FIELD ALLOCATION — keep the legal categories distinct: the BRAND NAME is the name the product is " +
  "SOLD under (if there is no separate brand, the producer/bottler/importer company name is the brand — and a " +
  "masthead that is an ACRONYM / INITIALS / SHORTENING of the producer, e.g. \"ABC\" for \"ABC Distillery\", is " +
  "NOT a separate brand; use the full producer name as the brand). The " +
  "CLASS/TYPE DESIGNATION is the standard of identity (\"Rum\", \"Vodka\"). A distinctive or fanciful / \"sell\" " +
  "name (e.g. \"Spiced Rum\", \"Single Barrel\") and marketing puffery (\"Superior\", \"Premium\", \"Smooth\", " +
  "\"Handcrafted\", \"Legendary\") are NEITHER the brand NOR, by themselves, the class/type — never put them in " +
  "`brand`, and never put puffery in `classType`.\n" +
  "5. Return exactly ONE JSON object and nothing else — no prose, no markdown, no code fences.\n" +
  "6. A product may have several label images (front/back/neck). You are shown ONE of them — extract " +
  'only what is visible on THIS image and leave the rest "" with low confidence.';

export const USER_PROMPT =
  "Read EVERY piece of text on this label — top, bottom, sides, and small/fine print. Transcribe each " +
  "field exactly as printed, preserving capitalization, digits, punctuation, and symbols; do not " +
  "interpret, normalize, translate, autocomplete, or correct. For multi-column layouts read left to " +
  'right. Use "" with low confidence ONLY when the text is truly not present. Each field\'s specific ' +
  "rule is given in its schema description.";

function coerceConfidenced(v: unknown): RawConfidencedValue | undefined {
  if (typeof v === "object" && v !== null && "value" in v) {
    const obj = v as { value?: unknown; confidence?: unknown };
    const confidence = typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
      ? obj.confidence
      : 0;
    return { value: String(obj.value ?? ""), confidence };
  }
  return undefined;
}

/**
 * Pull the first balanced JSON object out of a string, tolerating code fences or stray prose the
 * model may wrap around it (```json ... ```, "Here is the JSON: { ... }"). Returns null if none.
 */
function extractFirstJsonObject(content: string): string | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return content.slice(start, end + 1);
}

/**
 * Parse the model's JSON content defensively into ExtractedFields. Shared by all real providers
 * (Azure OpenAI, OpenAI-direct, Gemini); strict structured outputs make the happy path reliable,
 * but this stays as a guard that also recovers JSON a model may wrap in fences/prose.
 */
export function parseModelJson(content: string): ExtractedFields {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Recover the first balanced object before giving up (in case a model wraps it in fences/prose).
    const candidate = extractFirstJsonObject(content);
    if (candidate === null) {
      throw new Error("The model returned content that was not valid JSON.");
    }
    try {
      parsed = JSON.parse(candidate);
    } catch {
      throw new Error("The model returned content that was not valid JSON.");
    }
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The model returned an unexpected payload.");
  }
  const p = parsed as Record<string, unknown>;
  const raw: RawExtractedFields = {
    brand: coerceConfidenced(p.brand),
    class: coerceConfidenced(p.class),
    classType: coerceConfidenced(p.classType),
    alcoholContent: coerceConfidenced(p.alcoholContent),
    netContents: coerceConfidenced(p.netContents),
    warningText: coerceConfidenced(p.warningText),
    name: coerceConfidenced(p.name),
    address: coerceConfidenced(p.address),
    countryOfOrigin: coerceConfidenced(p.countryOfOrigin),
    appellation: coerceConfidenced(p.appellation),
    vintage: coerceConfidenced(p.vintage),
    varietal: coerceConfidenced(p.varietal),
    sulfiteDeclaration: coerceConfidenced(p.sulfiteDeclaration),
    ageStatement: coerceConfidenced(p.ageStatement),
    commodityStatement: coerceConfidenced(p.commodityStatement),
    warningPrefixIsAllCaps:
      p.warningPrefixIsAllCaps === true ? true : p.warningPrefixIsAllCaps === false ? false : null,
    warningPrefixIsBold:
      p.warningPrefixIsBold === true ? true : p.warningPrefixIsBold === false ? false : null,
  };
  return mapRawExtracted(raw);
}

/**
 * Best-effort actionable detail for a non-OK chat-completions response. The injectable FetchLike only
 * exposes json(), so read it defensively and surface the structured `error.message`, plus the caller's
 * status hint. Never throws — a result of "" is fine.
 */
async function chatCompletionErrorDetail(
  res: { status: number; json: () => Promise<unknown> },
  hint: string,
): Promise<string> {
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

/** The shared multimodal request body (system + user-with-image). `extra` lets OpenAI add `model`. */
export function buildExtractionBody(
  image: ImageInput,
  dataUrl: string,
  extra?: Record<string, unknown>,
  temperature = 0,
): object {
  return {
    ...extra,
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
    temperature,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: EXTRACTION_RESPONSE_FORMAT,
  };
}

export const BOLD_PROMPT =
  'Look ONLY at the government health warning on this label. Compare the visual weight (stroke width ' +
  'and darkness) of the "GOVERNMENT WARNING:" prefix against the warning body that follows it. Is the ' +
  'prefix clearly bolder than the body? Respond as JSON {"bold":"BOLDER"|"SAME"|"CANNOT_DETERMINE"}. ' +
  "If there is no warning, use CANNOT_DETERMINE.";

const BOLD_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: { name: "warning_bold", strict: true, schema: {
    type: "object", properties: { bold: { type: "string", enum: ["BOLDER", "SAME", "CANNOT_DETERMINE"] } },
    required: ["bold"], additionalProperties: false } },
} as const;

/** Shared OpenAI-dialect bold judgment. Returns true/false/null; never throws. */
export async function judgeWarningBoldViaChat(opts: {
  fetchImpl: FetchLike; url: string; headers: Record<string, string>; dataUrl: string; signal?: AbortSignal;
}): Promise<boolean | null> {
  try {
    const res = await fetchWithRetry(opts.fetchImpl, opts.url, {
      method: "POST",
      headers: { ...opts.headers, "content-type": "application/json" },
      signal: withHardTimeout(opts.signal),
      body: JSON.stringify({
        messages: [{ role: "user", content: [
          { type: "text", text: BOLD_PROMPT },
          { type: "image_url", image_url: { url: opts.dataUrl, detail: "high" } },
        ] }],
        temperature: 0,
        max_tokens: 50,
        response_format: BOLD_RESPONSE_FORMAT,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const verdict = (JSON.parse(content) as { bold?: string }).bold;
    return verdict === "BOLDER" ? true : verdict === "SAME" ? false : null;
  } catch {
    return null;
  }
}

/**
 * Shared OpenAI-dialect chat-completions call: POST (with retry + hard timeout), then surface non-OK /
 * HTTP-200-error / content-filter / length / empty-content failures with the given provider `label`,
 * else parse the JSON. OpenAI-direct and Azure OpenAI differ ONLY in url/headers/body and the status
 * hint, so the response handling lives here once. (Gemini uses a different dialect and stays separate.)
 */
export async function callChatCompletion(opts: {
  fetchImpl: FetchLike;
  url: string;
  headers: Record<string, string>;
  body: object;
  label: string;
  hintFor: (status: number) => string;
  signal?: AbortSignal;
}): Promise<ExtractedFields> {
  const { fetchImpl, url, headers, body, label, hintFor, signal } = opts;
  const res = await fetchWithRetry(fetchImpl, url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    signal: withHardTimeout(signal),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `${label} request failed with status ${res.status}${await chatCompletionErrorDetail(res, hintFor(res.status))}.`,
    );
  }
  const json = (await res.json()) as {
    error?: { message?: string; code?: string };
    choices?: { finish_reason?: string; message?: { content?: unknown } }[];
  };
  // Some failures arrive as HTTP 200 with a top-level error object — surface them, don't parse.
  if (json.error) {
    throw new Error(`${label} error: ${json.error.message ?? json.error.code ?? "unknown"}.`);
  }
  const choice = json.choices?.[0];
  if (choice?.finish_reason === "content_filter") {
    throw new Error(`${label} declined to read this image (content filter).`);
  }
  if (choice?.finish_reason === "length") {
    throw new Error(`${label} response was truncated (raise max_tokens).`);
  }
  const content = choice?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error(`${label} response did not include message content.`);
  }
  return parseModelJson(content);
}

export class LlmVisionProvider implements VisionProvider {
  readonly name = "llm" as const;
  private readonly config: AzureOpenAIConfig;
  private readonly fetchImpl: FetchLike;

  constructor(opts?: { config?: AzureOpenAIConfig; fetchImpl?: FetchLike }) {
    // Reads + validates env at construction so misconfiguration fails fast and clearly.
    this.config = opts?.config ?? readAzureOpenAIConfig();
    this.fetchImpl = opts?.fetchImpl ?? defaultFetch;
  }

  async extract(image: ImageInput, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedFields> {
    if (!image.data || image.data.length === 0) {
      throw new Error("The llm provider requires image bytes (image.data).");
    }
    const dataUrl = `data:${image.contentType ?? "image/jpeg"};base64,${Buffer.from(image.data).toString("base64")}`;
    const url =
      `${this.config.endpoint.replace(/\/+$/, "")}/openai/deployments/` +
      `${this.config.deployment}/chat/completions?api-version=${this.config.apiVersion}`;
    const temperature = options?.sample ? 0.7 : 0;

    return callChatCompletion({
      fetchImpl: this.fetchImpl,
      url,
      headers: { "api-key": this.config.apiKey },
      body: buildExtractionBody(image, dataUrl, undefined, temperature),
      label: "Azure OpenAI",
      hintFor: (status) =>
        status === 401 ? " (check AZURE_OPENAI_API_KEY)" : status === 429 ? " (rate limited — retry shortly)" : "",
      signal,
    });
  }

  async judgeWarningBold(image: ImageInput, signal?: AbortSignal): Promise<boolean | null> {
    if (!image.data || image.data.length === 0) return null;
    const dataUrl = `data:${image.contentType ?? "image/jpeg"};base64,${Buffer.from(image.data).toString("base64")}`;
    const url =
      `${this.config.endpoint.replace(/\/+$/, "")}/openai/deployments/` +
      `${this.config.deployment}/chat/completions?api-version=${this.config.apiVersion}`;
    return judgeWarningBoldViaChat({
      fetchImpl: this.fetchImpl,
      url,
      headers: { "api-key": this.config.apiKey },
      dataUrl,
      signal,
    });
  }
}
