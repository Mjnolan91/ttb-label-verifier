/**
 * pacing.test.ts — the batch read's resilience math: which failures are worth retrying, the
 * full-jitter backoff schedule, and the adaptive concurrency gate (AIMD: any transient failure
 * HALVES the target and opens a bounded cooldown; sustained success ramps back up).
 */
import { describe, expect, it, vi } from "vitest";
import { createPacer, isRetryableStatus, retryDelayMs, MAX_READ_ATTEMPTS } from "./pacing";

describe("isRetryableStatus", () => {
  it("retries throttling and transient gateway failures only", () => {
    for (const s of [429, 502, 503, 504]) expect(isRetryableStatus(s)).toBe(true);
    // 4xx validation and the 500 "not configured" operator error must NEVER auto-retry: retrying a
    // missing API key burns a minute per row and lies to the user about what is wrong.
    for (const s of [200, 400, 413, 415, 500]) expect(isRetryableStatus(s)).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("is full-jittered exponential: random in [0, min(30s, 2s * 2^attempt))", () => {
    expect(retryDelayMs(0, () => 0.5)).toBe(1_000);
    expect(retryDelayMs(1, () => 0.5)).toBe(2_000);
    expect(retryDelayMs(2, () => 0.5)).toBe(4_000);
    expect(retryDelayMs(10, () => 0.5)).toBe(15_000); // ceiling capped at 30s
    expect(retryDelayMs(3, () => 0)).toBe(0); // full jitter reaches zero
  });
});

describe("MAX_READ_ATTEMPTS", () => {
  it("is bounded — 'try until it gets it right' must not mean an unbounded loop against a dead key", () => {
    expect(MAX_READ_ATTEMPTS).toBe(6);
  });
});

describe("createPacer", () => {
  it("halves the concurrency target on failure (TCP-style) and ramps back after 3 successes", () => {
    const pacer = createPacer({ start: 3, min: 1, max: 4 });
    expect(pacer.target).toBe(3);
    pacer.reportFailure(50);
    expect(pacer.target).toBe(1); // floor(3/2), clamped to min
    pacer.reportSuccess();
    pacer.reportSuccess();
    expect(pacer.target).toBe(1);
    pacer.reportSuccess();
    expect(pacer.target).toBe(2);
    for (let i = 0; i < 9; i++) pacer.reportSuccess();
    expect(pacer.target).toBe(4); // never above max
  });

  it("halves rather than cratering: one 429 must not collapse a wide pool to 1", () => {
    const pacer = createPacer({ start: 8, min: 1, max: 8 });
    pacer.reportFailure(50);
    expect(pacer.target).toBe(4);
    pacer.reportFailure(50);
    expect(pacer.target).toBe(2);
    pacer.reportFailure(50);
    expect(pacer.target).toBe(1); // sustained failure still reaches the floor fast
  });

  it("caps the pool-wide cooldown even when the failing row's backoff is far longer", async () => {
    vi.useFakeTimers();
    try {
      const pacer = createPacer({ start: 2, min: 1, max: 8 });
      pacer.reportFailure(60_000); // the row sleeps this; the POOL must not
      let acquired = false;
      const p = pacer.acquire().then(() => {
        acquired = true;
      });
      await vi.advanceTimersByTimeAsync(4_900);
      expect(acquired).toBe(false); // still inside the capped window
      await vi.advanceTimersByTimeAsync(200);
      await p;
      expect(acquired).toBe(true); // free after ~5s, not 60s
    } finally {
      vi.useRealTimers();
    }
  });

  it("acquire blocks while in-flight is at the target, and unblocks on release", async () => {
    const pacer = createPacer({ start: 1, min: 1, max: 4 });
    await pacer.acquire();
    let second = false;
    const pending = pacer.acquire().then(() => {
      second = true;
    });
    await new Promise((r) => setTimeout(r, 90));
    expect(second).toBe(false); // gated: one in flight at target 1
    pacer.release();
    await pending;
    expect(second).toBe(true);
  });

  it("acquire waits out a failure cooldown before dispatching new work", async () => {
    const pacer = createPacer({ start: 2, min: 1, max: 4 });
    pacer.reportFailure(120);
    const started = Date.now();
    await pacer.acquire();
    expect(Date.now() - started).toBeGreaterThanOrEqual(90); // held back by the cooldown window
    pacer.release();
  });
});
