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
export {
  aggregateSamples,
  selfConsistentExtract,
  SUPERMAJORITY_DROPOUT_CONFIDENCE,
  SUPERMAJORITY_PRESENCE_FRACTION,
} from "./selfConsistency";
export { harvestOriginStatement } from "./harvest";
export {
  resolveSelfConsistencySamples,
  resolveLowConfidenceRescue,
  resolveWarningJudgeSamples,
  resolveRescueTimeoutMs,
} from "./config";
export { aggregateBoldVotes, combineBoldSignals } from "./boldJudgment";
export { rescueEligibleKeys, rescueRawKeys, applyRescue, readFieldsBounded } from "./rescue";

import type { VisionProvider } from "./VisionProvider";
import { MockVisionProvider } from "./MockVisionProvider";
import { LlmVisionProvider } from "./LlmVisionProvider";
import { OcrVisionProvider } from "./OcrVisionProvider";
import { OpenAIVisionProvider } from "./OpenAIVisionProvider";
import { GeminiVisionProvider } from "./GeminiVisionProvider";

/**
 * Describe an unknown VISION_PROVIDER value WITHOUT echoing it. Env values get pasted into the
 * wrong field (the classic: an API key in VISION_PROVIDER), and this error surfaces verbatim in the
 * /api/verify error body — echoing the raw value once leaked a live key to any unauthenticated
 * caller. A short safe name (letters/digits, like a typo'd "gemni") is fine to repeat; anything
 * else is summarized, and a key-shaped value gets an explicit it-looks-like-a-secret hint.
 */
export function describeUnknownProvider(value: string): string {
  const looksSecret = /^(sk-|aiza|key-|gsk_|xoxb-)/i.test(value) || value.length > 24;
  if (looksSecret) {
    return `VISION_PROVIDER is set to what looks like an API KEY (value hidden, ${value.length} chars). ` +
      "Set VISION_PROVIDER to a provider NAME and put the key in its own variable " +
      "(e.g. VISION_PROVIDER=openai + OPENAI_API_KEY=..., or VISION_PROVIDER=gemini + GEMINI_API_KEY=...). " +
      "If this value was a real key, ROTATE it: it was pasted into a non-secret field.";
  }
  const safe = /^[a-z0-9+_-]{1,24}$/i.test(value) ? `'${value}'` : `(unrecognized ${value.length}-char value, hidden)`;
  return `Unknown VISION_PROVIDER=${safe}. Use one of: mock|llm|ocr|openai|gemini|ensemble (default: mock).`;
}

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
      throw new Error(describeUnknownProvider(selected));
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
