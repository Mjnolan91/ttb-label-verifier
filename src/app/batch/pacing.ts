/**
 * pacing.ts — the batch read's resilience policy, owned by the CLIENT because it is the only place
 * with cross-product visibility (each /api/verify call is an isolated serverless invocation; no
 * shared server-side limiter exists on Vercel).
 *
 * Three pieces:
 *  - isRetryableStatus: only throttling/transient-gateway failures are worth retrying. Validation
 *    4xx and the 500 "reader not configured" operator error must surface immediately — auto-retrying
 *    them burns time and quota while lying about what is wrong.
 *  - retryDelayMs: full-jitter exponential backoff (AWS-style). Jitter is load-bearing: four rows
 *    failing together must not re-burst together.
 *  - createPacer: an adaptive concurrency gate (AIMD). Any transient failure anywhere in the pool
 *    HALVES the in-flight target (TCP-style multiplicative decrease, so the pool converges near the
 *    provider's sustainable rate instead of cratering to 1) and opens a bounded cooldown window (a
 *    lightweight circuit breaker; the failing row still sleeps its full jittered backoff, but the
 *    REST of the pool resumes within seconds); sustained success ramps the target back up one step
 *    per 3 consecutive successes.
 *
 * "It should never fail, it should try until it gets it right" is implemented as BOUNDED
 * persistence: 6 total attempts (~1 minute of full-jitter backoff) + an honest terminal state +
 * the one-click per-row Retry. An unbounded loop against an exhausted quota never succeeds and
 * starves the rows that could.
 */

/** Transient, retry-worthy HTTP statuses. Everything else surfaces immediately. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** Total tries per row (1 initial + 5 retries). */
export const MAX_READ_ATTEMPTS = 6;

/** Full-jitter exponential backoff: random in [0, min(30s, 2s * 2^attempt)). */
export function retryDelayMs(attempt: number, rng: () => number = Math.random): number {
  return Math.floor(rng() * Math.min(30_000, 2_000 * 2 ** attempt));
}

export interface Pacer {
  /** Resolve when a slot is free AND no failure cooldown is open; counts the caller in-flight. */
  acquire(): Promise<void>;
  /** Return the caller's slot. */
  release(): void;
  /** A completed read: ramp the target up one step per 3 consecutive successes. */
  reportSuccess(): void;
  /** A transient failure: halve the target and pause new dispatches for a bounded cooldown. */
  reportFailure(cooldownMs: number): void;
  readonly target: number;
}

export function createPacer(
  opts: { start?: number; min?: number; max?: number } = {},
): Pacer {
  const min = opts.min ?? 1;
  const max = opts.max ?? 4;
  let target = Math.min(max, Math.max(min, opts.start ?? 3));
  let inflight = 0;
  let successStreak = 0;
  let cooldownUntil = 0;
  return {
    get target() {
      return target;
    },
    async acquire() {
      // Polling keeps the gate simple and starvation-free at this scale (a handful of workers);
      // 25ms granularity is invisible next to multi-second reads.
      for (;;) {
        if (inflight < target && Date.now() >= cooldownUntil) {
          inflight++;
          return;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    release() {
      inflight = Math.max(0, inflight - 1);
    },
    reportSuccess() {
      successStreak++;
      if (successStreak >= 3 && target < max) {
        target++;
        successStreak = 0;
      }
    },
    reportFailure(cooldownMs: number) {
      // Halve, don't floor: three consecutive failures still reach the floor, but a single 429 no
      // longer costs the whole pool ~30-60s (floor-to-1 + a full jittered backoff as a global pause
      // + a 3-successes-per-step climb). The failing ROW still sleeps its entire backoff; only the
      // pool-wide dispatch pause is capped.
      target = Math.max(min, Math.floor(target / 2));
      successStreak = 0;
      cooldownUntil = Math.max(cooldownUntil, Date.now() + Math.min(cooldownMs, 5_000));
    },
  };
}
