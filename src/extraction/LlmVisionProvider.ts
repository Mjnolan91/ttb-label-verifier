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

/** Resolved Azure OpenAI connection config. */
export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

/** Minimal fetch shape the provider needs — injectable so tests avoid the network. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const DEFAULT_API_VERSION = "2024-10-21";

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

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

const SYSTEM_PROMPT =
  "You are a meticulous TTB alcohol-label reader. Read ONLY what is printed on the label image. " +
  "Never invent values. Report your per-field confidence honestly in [0,1].";

const USER_PROMPT =
  "Extract these fields from the label and return STRICT JSON with this exact shape:\n" +
  '{"brand":{"value":string,"confidence":number},' +
  '"classType":{"value":string,"confidence":number},' +
  '"alcoholContent":{"value":string,"confidence":number},' +
  '"netContents":{"value":string,"confidence":number},' +
  '"warningText":{"value":string,"confidence":number},' +
  '"warningPrefixIsAllCaps":boolean,"warningPrefixIsBold":boolean|null}\n' +
  'alcoholContent.value is the verbatim statement, e.g. "45% Alc./Vol. (90 Proof)". ' +
  'warningText.value is the full government warning verbatim ("" if absent). ' +
  "warningPrefixIsAllCaps/Bold describe the 'GOVERNMENT WARNING:' prefix (Bold null if undetectable).";

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

/** Parse the model's JSON content defensively into ExtractedFields. */
export function parseModelJson(content: string): ExtractedFields {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Azure OpenAI returned content that was not valid JSON.");
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

export class LlmVisionProvider implements VisionProvider {
  readonly name = "llm" as const;
  private readonly config: AzureOpenAIConfig;
  private readonly fetchImpl: FetchLike;

  constructor(opts?: { config?: AzureOpenAIConfig; fetchImpl?: FetchLike }) {
    // Reads + validates env at construction so misconfiguration fails fast and clearly.
    this.config = opts?.config ?? readAzureOpenAIConfig();
    this.fetchImpl = opts?.fetchImpl ?? defaultFetch;
  }

  async extract(image: ImageInput): Promise<ExtractedFields> {
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
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      throw new Error(`Azure OpenAI request failed with status ${res.status}.`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Azure OpenAI response did not include message content.");
    }
    return parseModelJson(content);
  }
}
