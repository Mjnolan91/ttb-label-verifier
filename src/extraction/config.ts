/** N reads for self-consistency (default 3; 1 disables). Read from SELF_CONSISTENCY_SAMPLES. */
export function resolveSelfConsistencySamples(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SELF_CONSISTENCY_SAMPLES ?? "3");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}
