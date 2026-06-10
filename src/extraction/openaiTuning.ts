/**
 * openaiTuning.ts — family-aware OpenAI chat-completions params (pure), the OpenAI counterpart of
 * geminiTuning.ts.
 *
 * The gpt-5 / o-series REASONING models take DIFFERENT params than the gpt-4 line, and sending the
 * classic idioms 400s the request (measured 2026-06-10 against gpt-5.5: "Unsupported parameter:
 * 'max_tokens' is not supported with this model"):
 *  - `max_tokens` is rejected; `max_completion_tokens` replaces it, and the budget must ALSO cover
 *    the model's hidden reasoning tokens — a tight cap starves the visible answer to empty.
 *  - non-default `temperature` is rejected; sampling variance comes from the model's default.
 *  - `reasoning_effort` exists; verbatim transcription and a single typography judgment need no deep
 *    reasoning, so the default is "low" — the only level anywhere near the ~5s budget. The effort is
 *    env-tunable (OPENAI_REASONING_EFFORT, resolved in config.ts) for measured experiments, and the
 *    reasoning HEADROOM scales with it: a "high" think can burn many thousands of hidden tokens, and
 *    a cap sized for "low" would starve the visible JSON to empty (truncation, not an error).
 *
 * Family detection keys off the MODEL id, which only the OpenAI-direct provider sends (Azure names a
 * deployment in the URL instead; an Azure gpt-5 deployment would need its own mapping and is out of
 * scope until someone runs one).
 */
import type { ReasoningEffort } from "./config";

/** Extra completion budget for the reasoning family's hidden reasoning tokens, per effort level.
 *  Generous on purpose: max_completion_tokens is a CAP, not a target — actual usage is billed. */
const REASONING_HEADROOM_TOKENS: Record<ReasoningEffort, number> = {
  low: 3500,
  medium: 10000,
  high: 25000,
};

export function isReasoningFamily(model: string | undefined): boolean {
  const m = (model ?? "").trim().toLowerCase();
  return /^(gpt-5|o\d)/.test(m);
}

/** The token/temperature/effort params for a chat-completions body, per model family. */
export function chatParams(
  model: string | undefined,
  maxOutputTokens: number,
  temperature: number,
  effort: ReasoningEffort = "low",
): Record<string, unknown> {
  if (!isReasoningFamily(model)) {
    return { temperature, max_tokens: maxOutputTokens };
  }
  return {
    max_completion_tokens: maxOutputTokens + REASONING_HEADROOM_TOKENS[effort],
    reasoning_effort: effort,
  };
}
