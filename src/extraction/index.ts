/**
 * extraction/index.ts — public surface + provider selection.
 *
 * `getVisionProvider()` resolves a SINGLE provider from `VISION_PROVIDER` (default: offline mock).
 * `getActiveProviders()` returns the provider LIST the verify path runs in parallel through the
 * reconciler — one for mock/llm/ocr, or both Azure providers for the "ensemble" mode. Selecting a
 * real provider without its env config errors cleanly and never touches the mock/test path.
 */
export type { ImageInput, VisionProvider, VisionProviderName, LabelPosition } from "./VisionProvider";
export type { FetchLike } from "./http";
export { isAbortOrTimeout } from "./http";
export { MockVisionProvider } from "./MockVisionProvider";
export {
  LlmVisionProvider,
  readAzureOpenAIConfig,
  parseModelJson,
  type AzureOpenAIConfig,
} from "./LlmVisionProvider";
export {
  OpenAIVisionProvider,
  readOpenAIConfig,
  type OpenAIConfig,
} from "./OpenAIVisionProvider";
export {
  GeminiVisionProvider,
  readGeminiConfig,
  type GeminiConfig,
} from "./GeminiVisionProvider";
export {
  OcrVisionProvider,
  readAzureDocIntelConfig,
  type AzureDocIntelConfig,
} from "./OcrVisionProvider";
export {
  reconcileExtract,
  mergeExtracted,
  extractWithTimeout,
  resolveTimeoutMs,
  DEFAULT_PER_CALL_TIMEOUT_MS,
  REAL_PROVIDER_TIMEOUT_MS,
  DISAGREEMENT_CONFIDENCE,
} from "./reconcile";

import type { VisionProvider } from "./VisionProvider";
import { MockVisionProvider } from "./MockVisionProvider";
import { LlmVisionProvider } from "./LlmVisionProvider";
import { OcrVisionProvider } from "./OcrVisionProvider";
import { OpenAIVisionProvider } from "./OpenAIVisionProvider";
import { GeminiVisionProvider } from "./GeminiVisionProvider";

/**
 * Resolve a single configured vision provider.
 * @param name optional explicit provider name; defaults to `process.env.VISION_PROVIDER`, then `mock`.
 * @throws if a real provider is selected without its env config, or the name is unknown. The mock
 *         path never throws and never touches the network.
 */
export function getVisionProvider(name?: string): VisionProvider {
  const selected = (name ?? process.env.VISION_PROVIDER ?? "mock").toLowerCase();
  switch (selected) {
    case "mock":
      return new MockVisionProvider();
    case "llm":
      // Azure OpenAI; reads env config at construction and errors cleanly if unset.
      return new LlmVisionProvider();
    case "ocr":
      // Azure AI Document Intelligence; reads env config at construction and errors cleanly if unset.
      return new OcrVisionProvider();
    case "openai":
      // OpenAI API directly (no Azure resource needed); errors cleanly if OPENAI_API_KEY is unset.
      return new OpenAIVisionProvider();
    case "gemini":
    case "google":
      // Google Gemini directly; errors cleanly if GEMINI_API_KEY / GOOGLE_API_KEY is unset.
      return new GeminiVisionProvider();
    default:
      throw new Error(
        `Unknown VISION_PROVIDER='${selected}'. Use one of: mock|llm|ocr|openai|gemini|ensemble (default: mock).`,
      );
  }
}

/**
 * Resolve the provider LIST to run in parallel through the reconciler. "ensemble" (aliases:
 * "llm+ocr", "all") runs Azure OpenAI + Azure Document Intelligence together; any other value is a
 * single provider. The default (mock) is a single-element list, so the verify path is uniform.
 */
export function getActiveProviders(name?: string): VisionProvider[] {
  const selected = (name ?? process.env.VISION_PROVIDER ?? "mock").toLowerCase();
  if (selected === "ensemble" || selected === "llm+ocr" || selected === "all") {
    return [new LlmVisionProvider(), new OcrVisionProvider()];
  }
  return [getVisionProvider(selected)];
}
