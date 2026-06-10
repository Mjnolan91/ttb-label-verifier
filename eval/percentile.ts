/**
 * percentile.ts — the ONE percentile definition (nearest-rank over an ASCENDING-sorted list).
 * A leaf module so consumers that only need the math (the eval report, the live-latency script)
 * don't drag in the whole eval/pipeline graph.
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, idx)];
}
