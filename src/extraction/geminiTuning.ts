/**
 * geminiTuning.ts — version-aware Gemini generation tuning (pure).
 *
 * Gemini 3 and Gemini 2.x take DIFFERENT params, and sending 2.x idioms to a Gemini 3 model degrades
 * it (temperature < 1.0 → "looping or degraded performance"; `thinkingBudget` is replaced by
 * `thinkingLevel`). This encodes the gen × mode matrix in one place so the provider never guesses.
 * Sources: ai.google.dev/gemini-api/docs/gemini-3, .../thinking, .../media-resolution.
 */
export type GeminiCallMode = "read" | "sample" | "bold";

export interface GeminiTuning {
  temperature: number;
  /** Exactly one of thinkingLevel (gen3) or thinkingBudget (2.x). */
  thinkingConfig: { thinkingLevel: "minimal" | "low" | "medium" | "high" } | { thinkingBudget: number };
  /** Per-part media resolution (gen3 only); undefined on 2.x. */
  mediaResolution?: { level: "media_resolution_high" | "media_resolution_ultra_high" };
}

/** Gemini 3 line by id prefix. Unknown ids default to gen3 (the current line) — conservative. */
export function isGemini3(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (/^gemini-[12]\b/.test(m) || /^gemini-1\.5|^gemini-2\./.test(m)) return false;
  return true;
}

export function geminiTuning(model: string, mode: GeminiCallMode): GeminiTuning {
  if (isGemini3(model)) {
    // Temperature must stay at the gen3 default (1.0); that default already provides sampling variance.
    return {
      temperature: 1,
      thinkingConfig: { thinkingLevel: mode === "bold" ? "high" : "minimal" },
      mediaResolution: { level: mode === "bold" ? "media_resolution_ultra_high" : "media_resolution_high" },
    };
  }
  // Legacy 2.x: greedy read, warmer sampling for variance, a thinking budget for the bold judgment.
  return {
    temperature: mode === "sample" ? 0.7 : 0,
    thinkingConfig: { thinkingBudget: mode === "bold" ? 2048 : 0 },
  };
}
