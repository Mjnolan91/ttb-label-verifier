/**
 * measure-live-latency.ts — measure END-TO-END /api/verify latency against a DEPLOYED target.
 *
 * The offline eval reports sub-millisecond pipeline latency (the mock skips the model call), so the
 * brief's ~5s budget can only be proven against a real deployment. This script POSTs the three
 * bundled sample labels to the target's /api/verify exactly the way the browser does (multipart
 * image + position + application brand/alcohol, so the full extract -> completeness -> compare path
 * runs) and prints per-sample and overall p50/p95 wall-clock times. Each response's verdict is also
 * checked against the sample's expected verdict, so a misconfigured target can't post good numbers.
 *
 *   npx tsx scripts/measure-live-latency.ts [baseUrl] [roundsPerImage]
 *
 * Defaults: the public demo URL, 5 rounds per sample (15 sequential requests). Requests run
 * SEQUENTIALLY to measure a single agent's experience (and to avoid hammering the demo). When the
 * target runs a real provider, every request costs real model calls — keep rounds modest. The first
 * request often includes serverless cold start; it is included in the numbers (an agent's first
 * read pays it too).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { percentile } from "../eval/percentile";

const DEFAULT_TARGET = "https://ttb-label-verifier-matthew-nolan-s-projects.vercel.app";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The three bundled demo labels with the application values the README walkthrough uses. */
const SAMPLES = [
  { filename: "demo-old-tom-clean.png", brand: "OLD TOM DISTILLERY", expect: "approve" },
  { filename: "demo-warning-title-case.png", brand: "OLD TOM DISTILLERY", expect: "reject" },
  { filename: "demo-brand-typo.png", brand: "Old Tom Distillery", expect: "review" },
] as const;
const ALCOHOL = "45% Alc./Vol. (90 Proof)";

interface Run {
  ms: number;
  ok: boolean;
  status: number;
  verdict: string | null;
  expected: string;
}

/** Ascending wall-clock times of the SUCCESSFUL runs — the one definition both summaries use. */
function okMsSorted(runs: Run[]): number[] {
  return runs.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
}

function summarize(runs: Run[]): string {
  const sorted = okMsSorted(runs);
  const fails = runs.length - sorted.length;
  if (sorted.length === 0) return `all ${runs.length} requests FAILED`;
  return (
    `n=${runs.length}  p50 ${(percentile(sorted, 50) / 1000).toFixed(1)}s  ` +
    `p95 ${(percentile(sorted, 95) / 1000).toFixed(1)}s  ` +
    `min ${(sorted[0] / 1000).toFixed(1)}s  max ${(sorted[sorted.length - 1] / 1000).toFixed(1)}s` +
    (fails > 0 ? `  (${fails} failed)` : "")
  );
}

async function main(): Promise<void> {
  const base = (process.argv[2] ?? DEFAULT_TARGET).replace(/\/$/, "");
  // Explicit but invalid/sub-1 round counts clamp to 1 (never silently back to the default: each
  // round is 3 paid requests against the target).
  const roundsArg = Number(process.argv[3] ?? "5");
  const rounds = Number.isFinite(roundsArg) ? Math.max(1, Math.floor(roundsArg)) : 5;
  const endpoint = `${base}/api/verify`;

  console.log(`Measuring ${endpoint} — ${rounds} round(s) x ${SAMPLES.length} samples, sequential\n`);

  const all: Run[] = [];
  for (const sample of SAMPLES) {
    const bytes = await readFile(path.join(REPO_ROOT, "eval", "fixtures", "images", sample.filename));
    const runs: Run[] = [];
    for (let i = 0; i < rounds; i++) {
      const form = new FormData();
      form.append("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), sample.filename);
      form.append("position", "front");
      form.append("brand", sample.brand);
      form.append("alcoholContent", ALCOHOL);
      const t0 = performance.now();
      let ok = false;
      let status = 0;
      let verdict: string | null = null;
      try {
        const res = await fetch(endpoint, { method: "POST", body: form });
        status = res.status;
        ok = res.ok;
        if (ok) {
          const json = (await res.json()) as { result?: { overall?: string } | null };
          verdict = json.result?.overall ?? null;
        }
      } catch {
        // network failure: recorded as a failed run below
      }
      const run: Run = { ms: performance.now() - t0, ok, status, verdict, expected: sample.expect };
      runs.push(run);
      const verdictNote = run.ok
        ? `verdict=${run.verdict ?? "(none)"}${run.verdict !== sample.expect ? ` (EXPECTED ${sample.expect})` : ""}`
        : `HTTP ${run.status || "ERR"}`;
      console.log(`  ${sample.filename} #${i + 1}: ${(run.ms / 1000).toFixed(1)}s ${verdictNote}`);
    }
    console.log(`${sample.filename} (expect ${sample.expect}): ${summarize(runs)}\n`);
    all.push(...runs);
  }

  console.log(`OVERALL: ${summarize(all)}`);
  const sorted = okMsSorted(all);
  if (sorted.length > 0) {
    console.log(percentile(sorted, 95) <= 5000 ? "p95 is inside the ~5s budget." : "p95 EXCEEDS the ~5s budget.");
  }
  const mismatches = all.filter((r) => r.ok && r.verdict !== r.expected).length;
  if (mismatches > 0) {
    console.log(`NOTE: ${mismatches} of ${sorted.length} successful runs returned a different verdict than expected (live model variance).`);
  }
  if (all.every((r) => !r.ok)) process.exitCode = 1; // target down/misconfigured
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
