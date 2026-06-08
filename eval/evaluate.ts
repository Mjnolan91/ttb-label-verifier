/**
 * eval/evaluate.ts — runs the REAL pipeline (mock provider, offline) over the labeled fixtures in
 * cases.json and computes per-field precision/recall, overall-verdict precision/recall, and latency
 * percentiles. The headline metric is APPROVE precision: of the labels we approved, how many were
 * actually approvable. A false approval is far worse than an extra human review, so the harness
 * enforces a high floor on it (see APPROVE_PRECISION_FLOOR). Pure logic — no printing, no exit; the
 * CLI wrapper (run.ts) handles those, and a unit test imports runEval() directly.
 */
import { MockVisionProvider } from "@/extraction";
import { runVerification } from "@/pipeline";
import type { ClaimedFields } from "@/domain";
import casesJson from "./fixtures/cases.json";

/**
 * Minimum precision on the `approve` verdict before the eval fails (exits non-zero). Set high on
 * purpose: in a compliance setting a missed violation (false approval) is far worse than an
 * unnecessary review, so we accept extra reviews but almost never a wrong approval.
 */
export const APPROVE_PRECISION_FLOOR = 0.98;

export type FieldStatus = "pass" | "review" | "fail";
export type OverallVerdict = "approve" | "review" | "reject";

const FIELDS = ["brand", "alcohol", "warning"] as const;
type FieldKey = (typeof FIELDS)[number];
const STATUSES: FieldStatus[] = ["pass", "review", "fail"];
const VERDICTS: OverallVerdict[] = ["approve", "review", "reject"];

interface RawCase {
  id: string;
  imageFilename: string;
  claimed: {
    brand: string;
    classType?: string;
    alcoholContent?: string;
    netContents?: string;
  };
  expected: {
    perField: Record<FieldKey, FieldStatus>;
    overall: OverallVerdict;
  };
}

const CASES = (casesJson as unknown as { cases: RawCase[] }).cases;

export interface CaseOutcome {
  id: string;
  expectedOverall: OverallVerdict;
  actualOverall: OverallVerdict;
  expectedFields: Record<FieldKey, FieldStatus>;
  actualFields: Record<FieldKey, FieldStatus>;
  latencyMs: number;
}

export interface PrecisionRecall {
  precision: number | null; // null when nothing was predicted for this class
  recall: number | null; // null when there were no expected instances of this class
  support: number; // number of expected instances
}

export interface EvalReport {
  cases: CaseOutcome[];
  /** verdict -> P/R over the overall verdict. */
  overall: Record<OverallVerdict, PrecisionRecall>;
  /** field -> status -> P/R over per-field statuses. */
  perField: Record<FieldKey, Record<FieldStatus, PrecisionRecall>>;
  approvePrecision: number; // 1 when no approvals were made (no false approvals possible)
  approvePrecisionFloor: number;
  passesFloor: boolean;
  overallAccuracy: number;
  latency: { p50: number; p95: number; count: number };
}

function buildClaimed(c: RawCase): ClaimedFields {
  return {
    brand: c.claimed.brand,
    classType: c.claimed.classType,
    alcoholContentText: c.claimed.alcoholContent,
    netContents: c.claimed.netContents,
  };
}

function precisionRecall(correct: number, predicted: number, expected: number): PrecisionRecall {
  return {
    precision: predicted === 0 ? null : correct / predicted,
    recall: expected === 0 ? null : correct / expected,
    support: expected,
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, idx)];
}

/** Run the pipeline over every fixture and compute the metrics. Offline (mock provider only). */
export async function runEval(): Promise<EvalReport> {
  const provider = new MockVisionProvider();
  const cases: CaseOutcome[] = [];

  for (const c of CASES) {
    const claimed = buildClaimed(c);
    const start = performance.now();
    const outcome = await runVerification([provider], claimed, [{ filename: c.imageFilename }]);
    const latencyMs = performance.now() - start;

    let actualOverall: OverallVerdict;
    let actualFields: Record<FieldKey, FieldStatus>;
    if (!outcome.readable || !outcome.result) {
      // Unreadable -> re-upload. Counts as "review" (a human must look), never "approve".
      actualOverall = "review";
      actualFields = { brand: "review", alcohol: "review", warning: "review" };
    } else {
      actualOverall = outcome.result.overall;
      actualFields = {
        brand: outcome.result.brand.status,
        alcohol: outcome.result.alcohol.status,
        warning: outcome.result.warning.status,
      };
    }

    cases.push({
      id: c.id,
      expectedOverall: c.expected.overall,
      actualOverall,
      expectedFields: c.expected.perField,
      actualFields,
      latencyMs,
    });
  }

  // Overall-verdict precision/recall.
  const overall = {} as Record<OverallVerdict, PrecisionRecall>;
  for (const v of VERDICTS) {
    const predicted = cases.filter((c) => c.actualOverall === v).length;
    const expected = cases.filter((c) => c.expectedOverall === v).length;
    const correct = cases.filter((c) => c.actualOverall === v && c.expectedOverall === v).length;
    overall[v] = precisionRecall(correct, predicted, expected);
  }

  // Per-field, per-status precision/recall.
  const perField = {} as Record<FieldKey, Record<FieldStatus, PrecisionRecall>>;
  for (const f of FIELDS) {
    perField[f] = {} as Record<FieldStatus, PrecisionRecall>;
    for (const s of STATUSES) {
      const predicted = cases.filter((c) => c.actualFields[f] === s).length;
      const expected = cases.filter((c) => c.expectedFields[f] === s).length;
      const correct = cases.filter(
        (c) => c.actualFields[f] === s && c.expectedFields[f] === s,
      ).length;
      perField[f][s] = precisionRecall(correct, predicted, expected);
    }
  }

  const predictedApprovals = cases.filter((c) => c.actualOverall === "approve").length;
  const correctApprovals = cases.filter(
    (c) => c.actualOverall === "approve" && c.expectedOverall === "approve",
  ).length;
  // No approvals -> no false approvals possible -> treat precision as 1 (floor satisfied).
  const approvePrecision = predictedApprovals === 0 ? 1 : correctApprovals / predictedApprovals;

  const overallAccuracy =
    cases.filter((c) => c.actualOverall === c.expectedOverall).length / (cases.length || 1);

  const latencies = cases.map((c) => c.latencyMs).sort((a, b) => a - b);

  return {
    cases,
    overall,
    perField,
    approvePrecision,
    approvePrecisionFloor: APPROVE_PRECISION_FLOOR,
    passesFloor: approvePrecision >= APPROVE_PRECISION_FLOOR,
    overallAccuracy,
    latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), count: latencies.length },
  };
}

function pct(v: number | null): string {
  return v === null ? "  — " : `${(v * 100).toFixed(1)}%`;
}

/** Render the report as a human-readable table (used by the CLI; testable). */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push("TTB Label Verifier — evaluation (mock provider, offline)");
  lines.push("=".repeat(64));
  lines.push("");
  lines.push("Per-field precision / recall (support = # expected):");
  lines.push("  field    status   precision   recall   support");
  for (const f of FIELDS) {
    for (const s of STATUSES) {
      const pr = report.perField[f][s];
      lines.push(
        `  ${f.padEnd(8)} ${s.padEnd(8)} ${pct(pr.precision).padStart(8)} ${pct(pr.recall).padStart(8)}   ${String(pr.support).padStart(3)}`,
      );
    }
  }
  lines.push("");
  lines.push("Overall verdict precision / recall:");
  lines.push("  verdict   precision   recall   support");
  for (const v of VERDICTS) {
    const pr = report.overall[v];
    lines.push(
      `  ${v.padEnd(8)} ${pct(pr.precision).padStart(8)} ${pct(pr.recall).padStart(8)}   ${String(pr.support).padStart(3)}`,
    );
  }
  lines.push("");
  lines.push(`Overall accuracy: ${pct(report.overallAccuracy)}  (${report.cases.length} cases)`);
  lines.push(`Latency: p50 ${report.latency.p50.toFixed(1)} ms, p95 ${report.latency.p95.toFixed(1)} ms`);
  lines.push("");
  lines.push(
    `APPROVE precision: ${pct(report.approvePrecision)} ` +
      `(floor ${pct(report.approvePrecisionFloor)}) -> ${report.passesFloor ? "PASS" : "FAIL"}`,
  );
  return lines.join("\n");
}
