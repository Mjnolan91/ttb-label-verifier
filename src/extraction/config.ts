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
 * Bold-judge samples per image. The judge answers ONE boolean (is the warning prefix bold?), so a
 * majority over 3 is as decisive as one over 7 — and the judge runs on the STRONG (slow, lower-rps)
 * model, speculatively, per image, concurrently with extraction. Capping it shrinks the per-verify
 * request burst (rate-limit hygiene) without touching extraction's consensus width. Default
 * min(samples, 3); WARNING_JUDGE_SAMPLES overrides, clamped to [1, samples].
 */
export function resolveWarningJudgeSamples(
  samples: number,
  env: Record<string, string | undefined> = process.env,
): number {
  const fallback = Math.min(samples, 3);
  const raw = env.WARNING_JUDGE_SAMPLES;
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  // A numeric low value clamps to 1 (the operator asked for the MINIMUM strong-model burst);
  // only non-numeric junk falls back to the default.
  return Math.min(samples, Math.max(1, Math.floor(n)));
}

/**
 * The rescue call's OWN time budget. The rescue runs on the provider's strongest model, whose
 * single read (~6.5s measured on gpt-5.5) can exceed a tight per-sample straggler cap — sharing
 * that cap made the rescue a guaranteed timeout that burned wall-clock and changed nothing
 * (found 2026-06-10, the Bonnaire regression investigation). Default max(per-call cap, 10s);
 * RESCUE_TIMEOUT_MS overrides, clamped to [1s, 30s] — the upper bound keeps extract + rescue
 * inside the route's maxDuration (60s) with headroom, so a generous env can't get the whole
 * request killed by the platform mid-pipeline.
 */
export function resolveRescueTimeoutMs(
  perCallTimeoutMs: number,
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.RESCUE_TIMEOUT_MS;
  if (raw !== undefined && raw.trim() !== "") {
    const ms = Number(raw);
    if (Number.isFinite(ms)) return Math.min(30_000, Math.max(1_000, Math.floor(ms)));
  }
  return Math.max(perCallTimeoutMs, 10_000);
}

/** Reasoning effort for gpt-5/o-series EXTRACTION reads (the classic gpt-4 line ignores it). */
export type ReasoningEffort = "low" | "medium" | "high";

/**
 * Reasoning effort for the gpt-5/o-series extraction calls. DEFAULT "low": verbatim transcription
 * needs no deep reasoning, and "low" is what keeps the reasoning family anywhere near the ~5s
 * budget. "medium"/"high" spend (many) hidden reasoning tokens per call — the request headroom
 * scales with the level (see openaiTuning.chatParams) so a long think cannot starve the visible
 * JSON, but latency and cost grow with it; treat any non-low setting as UNMEASURED until
 * scripts/test-sangria-live.ts or measure-live-latency proves it. Read from
 * OPENAI_REASONING_EFFORT; invalid/unset values fall back to "low".
 */
export function resolveOpenAIReasoningEffort(
  env: Record<string, string | undefined> = process.env,
): ReasoningEffort {
  const raw = env.OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  return raw === "medium" || raw === "high" ? raw : "low";
}

/**
 * Whether the low-confidence RESCUE pass runs (rescue.ts): when a verdict-relevant field lands in
 * the borderline band after the fast reads, the provider's STRONGEST model re-reads exactly those
 * fields across all the product's images in ONE bounded call. DEFAULT ON for providers that
 * support it (the mock never does, so the offline suite/eval are unaffected): unlike escalation
 * (more rolls of the same dice), the rescue adds a SMARTER reader, fires only on contested reads,
 * and is capped by the per-call straggler timeout. Set LOW_CONFIDENCE_RESCUE=0 to disable.
 */
export function resolveLowConfidenceRescue(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.LOW_CONFIDENCE_RESCUE?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off");
}

/**
 * Whether the WARNING FOCUS pass runs (warningFocus.ts): when the government warning is required
 * but still missing or format-unverified after the merge/judge/rescue, a dedicated strong-model
 * escalation locates it in any orientation, then re-judges from a cropped, derotated, upscaled
 * region. DEFAULT ON for providers that implement focusWarning (the mock never does, so the
 * offline suite/eval are unaffected). The warning is the one check that can hard-fail a label, and
 * a "could not verify" otherwise parks every subtle-weight or rotated capture in review forever.
 * Set WARNING_FOCUS=0 to disable.
 */
export function resolveWarningFocus(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.WARNING_FOCUS?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off");
}

/**
 * The focus pass's OWN per-stage time budget, mirroring the rescue's (resolveRescueTimeoutMs and
 * the 2026-06-10 RCA rationale: a strong-model read cannot live inside a tight per-sample straggler
 * cap). Default max(per-call cap, 10s); WARNING_FOCUS_TIMEOUT_MS overrides, clamped to [1s, 30s]
 * so two bounded stages still fit the route's maxDuration (60s) with headroom.
 */
export function resolveWarningFocusTimeoutMs(
  perCallTimeoutMs: number,
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.WARNING_FOCUS_TIMEOUT_MS;
  if (raw !== undefined && raw.trim() !== "") {
    const ms = Number(raw);
    if (Number.isFinite(ms)) return Math.min(30_000, Math.max(1_000, Math.floor(ms)));
  }
  return Math.max(perCallTimeoutMs, 10_000);
}

/**
 * Whether a multi-image product is read JOINTLY — every image of the product in ONE model request
 * (VisionProvider.extractAll) instead of per-image reads merged after the fact. DEFAULT ON for
 * providers that support it (the mock and OCR providers don't, so the offline suite/eval and the
 * Azure ensemble keep the per-image path): the model allocates fields with full cross-panel context
 * (the misallocation class the origin harvest patches over), and a product pays `samples` requests
 * instead of `images x samples` — directly fewer 429s under batch load. Set JOINT_EXTRACTION=0 to
 * fall back to per-image reads + merge.
 */
export function resolveJointExtraction(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.JOINT_EXTRACTION?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off");
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
