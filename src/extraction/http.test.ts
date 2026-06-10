/**
 * http.test.ts — the provider hard-timeout resolver (the never-hang cap, size-tunable for measured
 * experiments with slow configurations; the cap itself must survive every input).
 */
import { describe, expect, it } from "vitest";
import { PROVIDER_HARD_TIMEOUT_MS, resolveProviderHardTimeoutMs } from "./http";

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
