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

/**
 * Extra self-consistency samples drawn ONCE when a VERDICT-RELEVANT field lands in the borderline
 * band (present but below the 0.7 review gate) after the base reads — adaptive sampling, so a
 * single noisy read out of 3 cannot doom a good field to review (2/3 -> 4/5 when the extra reads
 * agree), while genuine splits still land below the gate. Clamped to [0, 3] (one bounded extra
 * batch, never a loop). Read from SELF_CONSISTENCY_ESCALATION.
 *
 * DEFAULT 0 (opt-in), by measurement: with escalation on, contested reads pay an extra parallel
 * batch and the live demo's p50 rose from ~4.1s toward the ~5s budget ceiling (2026-06-10 runs),
 * compounding under free-tier rate quotas. The CLUSTERED vote already absorbs cosmetic variance at
 * zero cost; set =2 on an in-tenant deployment with provisioned quota when accuracy on contested
 * reads is worth the tail latency.
 */
export function resolveSelfConsistencyEscalation(
  env: Record<string, string | undefined> = process.env,
): number {
  const n = Number(env.SELF_CONSISTENCY_ESCALATION ?? "0");
  return Number.isFinite(n) && n >= 0 ? Math.min(3, Math.floor(n)) : 0;
}

/**
 * Optional model override for the DEDICATED government-warning judge pass (the bold/format
 * verification). The warning is the one check that can hard-fail a label, so it can justify a
 * stronger (slower) model than the bulk extraction reads: for the gemini/openai providers this is a
 * model id (e.g. gemini-3.1-pro-preview, gpt-5.2); for Azure (llm) it names a DEPLOYMENT. Unset ->
 * the judge runs on the same model as extraction. Read from WARNING_JUDGE_MODEL.
 */
export function resolveWarningJudgeModel(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.WARNING_JUDGE_MODEL?.trim();
  return raw ? raw : undefined;
}
