/**
 * OcrVisionProvider.ts — second extractor (US-010), reference impl targets **Azure AI Document
 * Intelligence** (prebuilt-read OCR). Like the LLM provider this is the in-tenant firewall-survival
 * path; the VisionProvider interface stays generic. Config is env-only; the HTTP layer is injectable
 * so unit tests run with no live network. Selecting it without config errors cleanly; the default
 * `mock` provider needs no keys, so dev/tests are unaffected.
 *
 * OCR returns text, not semantics, so it reads the alcohol statement, the government warning, and
 * net contents by pattern, and reports the warning prefix's bold-ness as `null` (OCR has no type
 * metadata — exactly the tri-state the domain models). It leaves brand/class to the LLM; the
 * reconciler merges the two readings.
 */
import type { ExtractedFields } from "@/domain";
import type { ImageInput, VisionProvider } from "./VisionProvider";
import { mapRawExtracted, type RawExtractedFields } from "./extractedShape";
import { defaultFetch, type FetchLike } from "./http";

export interface AzureDocIntelConfig {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  model: string;
}

const DEFAULT_API_VERSION = "2024-11-30";
const DEFAULT_MODEL = "prebuilt-read";
const DEFAULT_FALLBACK_CONFIDENCE = 0.85;

/** Read + validate Azure Document Intelligence config from env. Throws listing any missing vars. */
export function readAzureDocIntelConfig(
  env: Record<string, string | undefined> = process.env,
): AzureDocIntelConfig {
  const endpoint = env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim();
  const apiKey = env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim();
  const apiVersion = env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION?.trim() || DEFAULT_API_VERSION;
  const model = env.AZURE_DOCUMENT_INTELLIGENCE_MODEL?.trim() || DEFAULT_MODEL;

  if (!endpoint || !apiKey) {
    const missing: string[] = [];
    if (!endpoint) missing.push("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT");
    if (!apiKey) missing.push("AZURE_DOCUMENT_INTELLIGENCE_KEY");
    throw new Error(
      `Azure Document Intelligence (VISION_PROVIDER=ocr) is not configured: set ${missing.join(", ")}. ` +
        "The default 'mock' provider needs no keys.",
    );
  }
  return { endpoint, apiKey, apiVersion, model };
}

interface AnalyzeResult {
  content?: string;
  pages?: { words?: { confidence?: number }[] }[];
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted while polling.", "AbortError"));
      },
      { once: true },
    );
  });
}

function averageConfidence(result: AnalyzeResult): number {
  const confidences: number[] = [];
  for (const page of result.pages ?? []) {
    for (const word of page.words ?? []) {
      if (typeof word.confidence === "number") confidences.push(word.confidence);
    }
  }
  if (confidences.length === 0) return DEFAULT_FALLBACK_CONFIDENCE;
  return confidences.reduce((a, b) => a + b, 0) / confidences.length;
}

/** Best-effort field extraction from the OCR text. */
function deriveRawFields(content: string, confidence: number): RawExtractedFields {
  const text = content.replace(/\s+/g, " ");

  const alcoholMatch = text.match(
    /\d+(?:\.\d+)?\s*%\s*alc\.?\s*\/?\s*vol\.?(?:\s*\(\s*\d+(?:\.\d+)?\s*proof\s*\))?/i,
  );
  const netMatch = text.match(/\d+(?:\.\d+)?\s*(?:ml|fl\.?\s*oz|liters?|l)\b/i);

  const warningIdx = text.search(/government\s+warning/i);
  const warningText = warningIdx >= 0 ? text.slice(warningIdx).trim() : undefined;
  // Exact-uppercase prefix present in the raw OCR text => all-caps; OCR can't judge bold => null.
  const allCaps = /GOVERNMENT WARNING/.test(content);

  return {
    alcoholContent: alcoholMatch
      ? { value: alcoholMatch[0].replace(/\s+/g, " ").trim(), confidence }
      : undefined,
    netContents: netMatch ? { value: netMatch[0].replace(/\s+/g, " ").trim(), confidence } : undefined,
    warningText: warningText !== undefined ? { value: warningText, confidence } : undefined,
    warningPrefixIsAllCaps: allCaps,
    warningPrefixIsBold: null,
  };
}

export class OcrVisionProvider implements VisionProvider {
  readonly name = "ocr" as const;
  private readonly config: AzureDocIntelConfig;
  private readonly fetchImpl: FetchLike;

  constructor(opts?: { config?: AzureDocIntelConfig; fetchImpl?: FetchLike }) {
    this.config = opts?.config ?? readAzureDocIntelConfig();
    this.fetchImpl = opts?.fetchImpl ?? defaultFetch;
  }

  async extract(image: ImageInput, signal?: AbortSignal): Promise<ExtractedFields> {
    if (!image.data || image.data.length === 0) {
      throw new Error("The ocr provider requires image bytes (image.data).");
    }
    const base64 = Buffer.from(image.data).toString("base64");
    const base = this.config.endpoint.replace(/\/+$/, "");
    const analyzeUrl =
      `${base}/documentintelligence/documentModels/${this.config.model}:analyze` +
      `?api-version=${this.config.apiVersion}`;

    const submit = await this.fetchImpl(analyzeUrl, {
      method: "POST",
      headers: { "api-key": this.config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ base64Source: base64 }),
      signal,
    });
    if (!submit.ok) {
      throw new Error(`Azure Document Intelligence analyze failed with status ${submit.status}.`);
    }
    const opLocation = submit.headers?.get("operation-location");
    if (!opLocation) {
      throw new Error("Azure Document Intelligence did not return an operation-location.");
    }

    const result = await this.poll(opLocation, signal);
    const raw = deriveRawFields(result.content ?? "", averageConfidence(result));
    return mapRawExtracted(raw);
  }

  private async poll(
    url: string,
    signal: AbortSignal | undefined,
    attempts = 20,
    intervalMs = 500,
  ): Promise<AnalyzeResult> {
    for (let i = 0; i < attempts; i++) {
      if (signal?.aborted) throw new DOMException("Aborted while polling.", "AbortError");
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: { "api-key": this.config.apiKey },
        signal,
      });
      if (!res.ok) {
        throw new Error(`Azure Document Intelligence poll failed with status ${res.status}.`);
      }
      const data = (await res.json()) as { status?: string; analyzeResult?: AnalyzeResult };
      if (data.status === "succeeded") return data.analyzeResult ?? {};
      if (data.status === "failed") throw new Error("Azure Document Intelligence analysis failed.");
      await sleep(intervalMs, signal);
    }
    throw new DOMException("Azure Document Intelligence polling timed out.", "TimeoutError");
  }
}
