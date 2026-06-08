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
import type { ImageInput, VisionProvider } from "./VisionProvider";
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
 */
const CONFIDENCED_VALUE = {
  type: "object",
  properties: { value: { type: "string" }, confidence: { type: "number" } },
  required: ["value", "confidence"],
  additionalProperties: false,
} as const;

// Derived from the single source of truth (fieldCatalog) so the strict-output schema can never drift
// from the field set the mapper/merge/UI/CSV use. (The prose USER_PROMPT stays hand-tuned per field.)
const CONFIDENCED_FIELDS: readonly string[] = FIELD_CATALOG.map((d) => d.rawKey);

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    ...Object.fromEntries(CONFIDENCED_FIELDS.map((f) => [f, CONFIDENCED_VALUE])),
    warningPrefixIsAllCaps: { type: "boolean" },
    warningPrefixIsBold: { type: ["boolean", "null"] },
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
  "verification. You read text from the image — you never judge compliance. Hard rules:\n" +
  "1. Transcribe ONLY text actually printed on the label in the image.\n" +
  "2. NEVER guess, infer, autocomplete, translate, or correct text. If a field is not legibly " +
  'present, return "" for its value and a LOW confidence (<= 0.3).\n' +
  "3. Report per-field confidence in [0,1] honestly, reflecting how legible the text is.\n" +
  "4. Return exactly ONE JSON object and nothing else — no prose, no markdown, no code fences.\n" +
  "5. A product may have several label images (front/back/neck). You are shown ONE of them — extract " +
  'only what is visible on THIS image and leave the rest "" with low confidence.';

export const USER_PROMPT =
  "Read EVERY piece of text on this label — top, bottom, sides, and small/fine print — and fill every " +
  'field that appears ANYWHERE on the image. Only use "" (with low confidence) when the text is truly ' +
  "not present. Return STRICT JSON with EXACTLY this shape:\n" +
  '{"brand":{"value":string,"confidence":number},' +
  '"class":{"value":string,"confidence":number},' +
  '"classType":{"value":string,"confidence":number},' +
  '"alcoholContent":{"value":string,"confidence":number},' +
  '"netContents":{"value":string,"confidence":number},' +
  '"name":{"value":string,"confidence":number},' +
  '"address":{"value":string,"confidence":number},' +
  '"countryOfOrigin":{"value":string,"confidence":number},' +
  '"appellation":{"value":string,"confidence":number},' +
  '"vintage":{"value":string,"confidence":number},' +
  '"varietal":{"value":string,"confidence":number},' +
  '"sulfiteDeclaration":{"value":string,"confidence":number},' +
  '"ageStatement":{"value":string,"confidence":number},' +
  '"commodityStatement":{"value":string,"confidence":number},' +
  '"warningText":{"value":string,"confidence":number},' +
  '"warningPrefixIsAllCaps":boolean,"warningPrefixIsBold":boolean|null}\n\n' +
  "Transcribe verbatim. Field rules:\n" +
  "- brand: the FANCIFUL product/brand mark — usually the largest text or a logo wordmark (e.g. " +
  '"Single Barrel", "Stone\'s Throw"). This is NOT automatically the bottling company: the legally ' +
  "responsible company belongs in `name`. Two decisive cases: (a) if the label shows a SHORT mark AND " +
  'a longer producer name that CONTAINS it (mark "ABC" + producer "ABC Distillery"), `brand` is the ' +
  'SHORT mark ("ABC") and `name` is the producer ("ABC Distillery") — never put the producer in ' +
  "`brand`; (b) if the SAME words are the ONLY prominent name (a label whose only large text is " +
  '"OLD TOM DISTILLERY"), populate BOTH `brand` and `name` with them.\n' +
  "- class: the BROAD category. This is the ONE field you may DERIVE rather than transcribe verbatim " +
  '(an explicit exception to Hard Rule #2): infer it from the printed designation, e.g. classType ' +
  '"Kentucky Straight Bourbon Whiskey" -> class "Whisky", "India Pale Ale" -> "Malt beverage", ' +
  '"Cabernet Sauvignon" -> "Wine".\n' +
  '- classType: the FULL specific designation / standard of identity, VERBATIM as printed (e.g. ' +
  '"Straight Rye Whisky", "Kentucky Straight Bourbon Whiskey", "Cabernet Sauvignon", "India Pale Ale").\n' +
  '- alcoholContent: VERBATIM alcohol statement (e.g. "45% Alc./Vol. (90 Proof)", "45% ALC/VOL"); do NOT convert units or compute proof.\n' +
  '- netContents: net contents as printed (e.g. "750 mL", "750 ML").\n' +
  "- name: the responsible-party COMPANY NAME only. It usually follows a verb like \"DISTILLED & " +
  'BOTTLED BY:", "PRODUCED BY", "IMPORTED BY" — e.g. from "DISTILLED AND BOTTLED BY: ABC DISTILLERY, ' +
  'FREDERICK, MD" the name is "ABC Distillery". Do NOT include the verb or the address.\n' +
  '- address: the responsible-party ADDRESS only (street/city/state), e.g. "Frederick, MD". Separate from name.\n' +
  "  NOTE: `name`, `address`, and `commodityStatement` are all PARSED FROM THE SAME printed " +
  "responsibility line — populate all three from it; do NOT leave name/address empty just because " +
  "commodityStatement is filled.\n" +
  '- countryOfOrigin: e.g. "Product of Scotland" (imports); "" if none.\n' +
  '- appellation: wine appellation of origin, e.g. "Napa Valley".\n' +
  '- vintage: wine vintage year, e.g. "2019".\n' +
  '- varietal: grape variety, e.g. "Cabernet Sauvignon".\n' +
  '- sulfiteDeclaration: e.g. "Contains Sulfites"; "" if none.\n' +
  '- ageStatement: e.g. "Aged 4 Years"; "" if none.\n' +
  '- commodityStatement: the full responsibility/commodity statement incl. the verb (e.g. "Distilled and bottled by ABC Distillery, Frederick, MD").\n' +
  '- warningText: the FULL government warning, verbatim from GOVERNMENT/Government through "...health problems.", preserving "(1) ... (2) ...". "" if absent.\n' +
  '- warningPrefixIsAllCaps: true ONLY if the "GOVERNMENT WARNING:" prefix is ALL CAPITAL LETTERS; false if title/mixed case.\n' +
  '- warningPrefixIsBold: true if that prefix is clearly bolder than the body; false ONLY if it is ' +
  "clearly the SAME weight as the body (a real violation); null if you cannot tell. When unsure, " +
  "return null — never guess true OR false (a wrong false rejects a compliant label).\n" +
  "- confidence: per-field legibility confidence in [0,1]; empty/illegible <= 0.3.";

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
    warningPrefixIsAllCaps: p.warningPrefixIsAllCaps === true,
    warningPrefixIsBold:
      p.warningPrefixIsBold === true ? true : p.warningPrefixIsBold === false ? false : null,
  };
  return mapRawExtracted(raw);
}

/**
 * Best-effort actionable detail for a non-OK Azure response. The injectable FetchLike only exposes
 * json(), so read it defensively and surface the structured `error.message`, plus a hint for the
 * common 401/429 cases. Never throws — a result of "" is fine.
 */
async function azureErrorDetail(res: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<string> {
  const hint =
    res.status === 401
      ? " (check AZURE_OPENAI_API_KEY)"
      : res.status === 429
        ? " (rate limited — retry shortly)"
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

export class LlmVisionProvider implements VisionProvider {
  readonly name = "llm" as const;
  private readonly config: AzureOpenAIConfig;
  private readonly fetchImpl: FetchLike;

  constructor(opts?: { config?: AzureOpenAIConfig; fetchImpl?: FetchLike }) {
    // Reads + validates env at construction so misconfiguration fails fast and clearly.
    this.config = opts?.config ?? readAzureOpenAIConfig();
    this.fetchImpl = opts?.fetchImpl ?? defaultFetch;
  }

  async extract(image: ImageInput, signal?: AbortSignal): Promise<ExtractedFields> {
    if (!image.data || image.data.length === 0) {
      throw new Error("The llm provider requires image bytes (image.data).");
    }
    const base64 = Buffer.from(image.data).toString("base64");
    const dataUrl = `data:${image.contentType ?? "image/jpeg"};base64,${base64}`;

    const url =
      `${this.config.endpoint.replace(/\/+$/, "")}/openai/deployments/` +
      `${this.config.deployment}/chat/completions?api-version=${this.config.apiVersion}`;

    const res = await fetchWithRetry(this.fetchImpl, url, {
      method: "POST",
      headers: { "api-key": this.config.apiKey, "content-type": "application/json" },
      signal: withHardTimeout(signal),
      body: JSON.stringify({
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
      throw new Error(`Azure OpenAI request failed with status ${res.status}${await azureErrorDetail(res)}.`);
    }
    const json = (await res.json()) as {
      error?: { message?: string; code?: string };
      choices?: { finish_reason?: string; message?: { content?: unknown } }[];
    };
    // Some failures arrive as HTTP 200 with a top-level error object — surface them, don't parse.
    if (json.error) {
      throw new Error(`Azure OpenAI error: ${json.error.message ?? json.error.code ?? "unknown"}.`);
    }
    const choice = json.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      throw new Error("Azure OpenAI declined to read this image (content filter).");
    }
    if (choice?.finish_reason === "length") {
      throw new Error("Azure OpenAI response was truncated (raise max_tokens).");
    }
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("Azure OpenAI response did not include message content.");
    }
    return parseModelJson(content);
  }
}
