/**
 * LlmVisionProvider.ts — real fast-tier multimodal extractor (US-009).
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
import { defaultFetch, type FetchLike } from "./http";

/** Resolved Azure OpenAI connection config. */
export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

const DEFAULT_API_VERSION = "2024-10-21";

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
  "4. Return exactly ONE JSON object and nothing else — no prose, no markdown, no code fences.";

export const USER_PROMPT =
  "Extract these fields from the alcohol label image and return STRICT JSON with EXACTLY this shape:\n" +
  '{"brand":{"value":string,"confidence":number},' +
  '"classType":{"value":string,"confidence":number},' +
  '"alcoholContent":{"value":string,"confidence":number},' +
  '"netContents":{"value":string,"confidence":number},' +
  '"warningText":{"value":string,"confidence":number},' +
  '"warningPrefixIsAllCaps":boolean,"warningPrefixIsBold":boolean|null}\n\n' +
  "Field rules:\n" +
  "- brand: the brand name exactly as printed (e.g. \"OLD TOM DISTILLERY\").\n" +
  "- classType: the class/type designation (e.g. \"Kentucky Straight Bourbon Whiskey\").\n" +
  "- alcoholContent: the VERBATIM alcohol statement exactly as printed, e.g. " +
  '"45% Alc./Vol. (90 Proof)" or "13.5% ALC BY VOL". Do NOT convert units or compute proof — copy the text.\n' +
  '- netContents: the net contents exactly as printed (e.g. "750 mL").\n' +
  "- warningText: the FULL government warning, verbatim from the word GOVERNMENT/Government through the " +
  'final "...health problems.", preserving the "(1) ... (2) ..." numbering. Use "" if no warning is present.\n' +
  "- warningPrefixIsAllCaps: true ONLY if the \"GOVERNMENT WARNING:\" prefix is printed in ALL CAPITAL " +
  'LETTERS; false if it is title-case or mixed-case (e.g. "Government Warning:").\n' +
  "- warningPrefixIsBold: true if that prefix is clearly heavier/bolder than the warning body text; " +
  "false if clearly the same weight; null if you cannot reliably judge stroke weight from the image. " +
  "When unsure, return null — never guess true.\n" +
  "- confidence: your per-field legibility confidence in [0,1]; empty or illegible fields must use <= 0.3.";

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

/** Parse the model's JSON content defensively into ExtractedFields. */
export function parseModelJson(content: string): ExtractedFields {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // The model occasionally wraps JSON in fences/prose despite json_object mode — recover the
    // first balanced object before giving up.
    const candidate = extractFirstJsonObject(content);
    if (candidate === null) {
      throw new Error("Azure OpenAI returned content that was not valid JSON.");
    }
    try {
      parsed = JSON.parse(candidate);
    } catch {
      throw new Error("Azure OpenAI returned content that was not valid JSON.");
    }
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Azure OpenAI returned an unexpected payload.");
  }
  const p = parsed as Record<string, unknown>;
  const raw: RawExtractedFields = {
    brand: coerceConfidenced(p.brand),
    classType: coerceConfidenced(p.classType),
    alcoholContent: coerceConfidenced(p.alcoholContent),
    netContents: coerceConfidenced(p.netContents),
    warningText: coerceConfidenced(p.warningText),
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

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "api-key": this.config.apiKey, "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: USER_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 800,
        response_format: { type: "json_object" },
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
    const content = choice?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("Azure OpenAI response did not include message content.");
    }
    return parseModelJson(content);
  }
}
