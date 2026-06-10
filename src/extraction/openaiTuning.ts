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
 *    reasoning, so "low" keeps latency inside the ~5s budget.
 *
 * Family detection keys off the MODEL id, which only the OpenAI-direct provider sends (Azure names a
 * deployment in the URL instead; an Azure gpt-5 deployment would need its own mapping and is out of
 * scope until someone runs one).
 */

/** Extra completion budget for the reasoning family's hidden reasoning tokens. */
const REASONING_HEADROOM_TOKENS = 3500;

export function isReasoningFamily(model: string | undefined): boolean {
  const m = (model ?? "").trim().toLowerCase();
  return /^(gpt-5|o\d)/.test(m);
}

/** The token/temperature/effort params for a chat-completions body, per model family. */
export function chatParams(
  model: string | undefined,
  maxOutputTokens: number,
  temperature: number,
): Record<string, unknown> {
  if (!isReasoningFamily(model)) {
    return { temperature, max_tokens: maxOutputTokens };
  }
  return {
    max_completion_tokens: maxOutputTokens + REASONING_HEADROOM_TOKENS,
    reasoning_effort: "low",
  };
}
