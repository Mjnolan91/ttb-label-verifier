/**
 * http.test.ts — the provider hard-timeout resolver (the never-hang cap, size-tunable for measured
 * experiments with slow configurations; the cap itself must survive every input).
 */
import { describe, expect, it, vi } from "vitest";
import { PROVIDER_HARD_TIMEOUT_MS, resolveProviderHardTimeoutMs, fetchWithRetry, sleep, type FetchLike } from "./http";

describe("sleep — abort safety", () => {
  it("rejects immediately on an ALREADY-aborted signal (no orphan timer running to completion)", async () => {
    // The 'abort' event never fires for a signal that aborted before addEventListener — without an
    // entry check, a Retry-After sleep started just after the per-sample cap fired would run its
    // full (unclamped, server-controlled) duration with nothing able to cancel it.
    const ctrl = new AbortController();
    ctrl.abort();
    const started = Date.now();
    await expect(sleep(60_000, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

/** A canned response whose headers are looked up case-insensitively, like the real Headers. */
function resp(status: number, headers: Record<string, string> = {}): Awaited<ReturnType<FetchLike>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  };
}

describe("fetchWithRetry — Retry-After handling on 429", () => {
  it("honors OpenAI's millisecond retry-after-ms header over the seconds variant (no oversleep)", async () => {
    // retry-after says 2 SECONDS; retry-after-ms says 10 MILLISECONDS. Sleeping 2s inside a ~5-8s
    // per-sample budget wastes the read; the ms variant is the one OpenAI actually tunes.
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(resp(429, { "retry-after": "2", "retry-after-ms": "10" }))
      .mockResolvedValueOnce(resp(200));
    const started = Date.now();
    const res = await fetchWithRetry(fetchImpl, "http://x", { method: "POST", headers: {} });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeLessThan(1000); // ms variant honored, not the 2s one
  });

  it("still honors the seconds retry-after when no ms variant is present", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(resp(429, { "retry-after": "0" }))
      .mockResolvedValueOnce(resp(200));
    const res = await fetchWithRetry(fetchImpl, "http://x", { method: "POST", headers: {} });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("resolveProviderHardTimeoutMs", () => {
  it("defaults to the 30s cap when unset/blank/junk", () => {
    expect(resolveProviderHardTimeoutMs({})).toBe(PROVIDER_HARD_TIMEOUT_MS);
    expect(resolveProviderHardTimeoutMs({ PROVIDER_HARD_TIMEOUT_MS: "" })).toBe(PROVIDER_HARD_TIMEOUT_MS);
    expect(resolveProviderHardTimeoutMs({ PROVIDER_HARD_TIMEOUT_MS: "soon" })).toBe(PROVIDER_HARD_TIMEOUT_MS);
  });

  it("honors a valid override and CLAMPS to [1s, 300s] — the cap is tunable, never removable", () => {
    expect(resolveProviderHardTimeoutMs({ PROVIDER_HARD_TIMEOUT_MS: "120000" })).toBe(120_000);
    expect(resolveProviderHardTimeoutMs({ PROVIDER_HARD_TIMEOUT_MS: "50" })).toBe(1_000);
    expect(resolveProviderHardTimeoutMs({ PROVIDER_HARD_TIMEOUT_MS: "999999999" })).toBe(300_000);
    expect(resolveProviderHardTimeoutMs({ PROVIDER_HARD_TIMEOUT_MS: "-5" })).toBe(1_000);
  });
});
