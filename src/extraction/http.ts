/**
 * http.ts — the minimal, injectable fetch shape shared by the real providers (Azure OpenAI,
 * Azure Document Intelligence), plus two resilience helpers used on every real request:
 *   - fetchWithRetry: bounded exponential backoff (honoring Retry-After) on transient failures.
 *   - withHardTimeout: composes the caller's abort signal with a self-limiting timeout so a
 *     request can never hang forever, even outside the reconciler's per-call race.
 * Injecting the fetch lets unit tests run with NO live network.
 */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers?: { get(name: string): string | null };
}>;

type FetchResponse = Awaited<ReturnType<FetchLike>>;

/** Default implementation backed by the global fetch (used in production / the real Azure path). */
export const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** A self-limiting cap so a real request can never hang indefinitely, independent of the caller. */
export const PROVIDER_HARD_TIMEOUT_MS = 30_000;

/** Transient HTTP statuses worth retrying (idempotent reads only): throttling + server hiccups. */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

/** Whether an error is an abort or a timeout (the wire contract for the 504/re-upload path). Shared
 *  so the route, pipeline, reconciler, and retry layer classify failures identically. */
export function isAbortOrTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

/** Abort-aware delay: resolves after `ms`, or rejects with an AbortError if `signal` fires first. */
export function sleep(ms: number, signal?: AbortSignal, message = "Aborted while waiting."): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException(message, "AbortError"));
      },
      { once: true },
    );
  });
}

/** Retry-After (seconds) from a response, in ms; null when absent/non-numeric. */
function retryAfterMs(headers: FetchResponse["headers"]): number | null {
  const raw = headers?.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** Full-jittered exponential backoff: base * 2^attempt plus up to `base` of jitter. */
function backoffMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt + Math.floor(Math.random() * baseDelayMs);
}

/**
 * Compose the caller's abort signal with a self-limiting timeout. The timeout's timer is unref'd by
 * the runtime, so it never keeps the process alive on its own. Returns a signal that aborts when
 * EITHER the caller aborts or the hard cap elapses.
 */
export function withHardTimeout(
  signal: AbortSignal | undefined,
  ms: number = PROVIDER_HARD_TIMEOUT_MS,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Issue a request with a bounded number of retries on transient failures (429/5xx/408/409 and
 * network blips), honoring Retry-After. A non-retryable status (401/400/404…) is returned as-is for
 * the caller to handle; an abort/timeout is rethrown immediately (never retried — the budget is up).
 */
export async function fetchWithRetry(
  fetchImpl: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<FetchResponse> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: FetchResponse;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      // An abort/timeout means the caller's budget is spent — don't burn it on retries.
      if (isAbortOrTimeout(err) || attempt === retries) throw err;
      lastError = err;
      await sleep(backoffMs(attempt, baseDelayMs), init.signal);
      continue;
    }
    if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === retries) return res;
    await sleep(retryAfterMs(res.headers) ?? backoffMs(attempt, baseDelayMs), init.signal);
  }
  // Unreachable: the loop returns or throws on the final attempt.
  throw lastError ?? new Error("Request failed after retries.");
}
