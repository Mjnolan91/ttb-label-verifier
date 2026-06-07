/**
 * http.ts — the minimal, injectable fetch shape shared by the real providers (Azure OpenAI,
 * Azure Document Intelligence). Injecting it lets unit tests run with NO live network.
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

/** Default implementation backed by the global fetch (used in production / the real Azure path). */
export const defaultFetch: FetchLike = (url, init) => fetch(url, init);
