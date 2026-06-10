/** N reads for self-consistency (default 3; 1 disables). Read from SELF_CONSISTENCY_SAMPLES. */
export function resolveSelfConsistencySamples(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SELF_CONSISTENCY_SAMPLES ?? "3");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

/**
 * Sampling temperature for the OpenAI/Azure chat self-consistency reads. The base read is greedy
 * (temperature 0); a SAMPLE needs SOME variance so the N reads can disagree where the model is
 * genuinely unsure — that disagreement IS the calibrated confidence signal. But for VERBATIM
 * transcription the old 0.7 ran too hot: it injected spurious character-level noise into otherwise
 * confident reads, diluting the agreement fraction and manufacturing needless reviews. The default
 * ~0.4 keeps real uncertainty visible without scrambling clean reads. Tune via
 * SELF_CONSISTENCY_TEMPERATURE. (Gemini 3 is a separate case — it is correctly forced to 1.0 in
 * geminiTuning and is NOT governed by this knob.)
 *
 * Clamped to the [0, 2] range the chat API accepts; an unset/blank/junk/out-of-range value falls
 * back to the default.
 */
export const DEFAULT_SELF_CONSISTENCY_TEMPERATURE = 0.4;

export function resolveSelfConsistencyTemperature(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.SELF_CONSISTENCY_TEMPERATURE;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SELF_CONSISTENCY_TEMPERATURE;
  const t = Number(raw);
  if (!Number.isFinite(t) || t < 0 || t > 2) return DEFAULT_SELF_CONSISTENCY_TEMPERATURE;
  return t;
}
