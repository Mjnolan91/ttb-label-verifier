/**
 * eval/evaluate.ts — runs the REAL pipeline (mock provider, offline) over the labeled fixtures in
 * cases.json and computes per-field precision/recall, overall-verdict precision/recall, confidence
 * calibration (Brier score + ECE), and latency percentiles. The headline metric is APPROVE precision:
 * of the labels we approved, how many were actually approvable. A false approval is far worse than an
 * extra human review, so the harness enforces a high floor on it (see APPROVE_PRECISION_FLOOR). Pure
 * logic — no printing, no exit; the CLI wrapper (run.ts) handles those, and a unit test imports
 * runEval() directly.
 *
 * Per-field metrics cover the three CFR-core checks (brand / alcohol / warning) AND the four
 * completeness-driving fields whose VALUE ALLOCATION the extractor must get right (classType,
 * netContents, fancifulName, statementOfComposition). The latter come off `VerifyResult.fields`,
 * scored only on the cases that supply both a claimed value (so the comparison runs) and an expected
 * status. See eval/fixtures/README.md for exactly what these fixtures prove (and do NOT prove).
 */
import { MockVisionProvider } from "@/extraction";
import { runVerification } from "@/pipeline";
import type { ClaimedFields } from "@/domain";
import { combinedVerdict } from "@/compare";
import { percentile } from "./percentile";
import casesJson from "./fixtures/cases.json";

/**
 * Minimum precision on the `approve` verdict before the eval fails (exits non-zero). Set high on
 * purpose: in a compliance setting a missed violation (false approval) is far worse than an
 * unnecessary review, so we accept extra reviews but almost never a wrong approval.
 */
export const APPROVE_PRECISION_FLOOR = 0.98;

export type FieldStatus = "pass" | "review" | "fail";
export type OverallVerdict = "approve" | "review" | "reject";

/** The three CFR-core checks, sourced from the named accessors on VerifyResult. */
const CORE_FIELDS = ["brand", "alcohol", "warning"] as const;
/**
 * The completeness-driving fields whose VALUE ALLOCATION the extractor must get right; sourced from
 * `VerifyResult.fields` (present only when the application supplied that field). Their eval field key
 * IS their VerifyField key, so the lookup is direct.
 */
const EXTRA_FIELDS = ["classType", "netContents", "fancifulName", "statementOfComposition"] as const;
const FIELDS = [...CORE_FIELDS, ...EXTRA_FIELDS] as const;
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
    name?: string;
    address?: string;
    countryOfOrigin?: string;
    fancifulName?: string;
    statementOfComposition?: string;
  };
  expected: {
    /** Per-field expected status. brand/alcohol/warning are always present; the four allocation
     *  fields are present only on the cases that exercise them (so they are scored selectively). */
    perField: Partial<Record<FieldKey, FieldStatus>>;
    overall: OverallVerdict;
  };
}

const CASES = (casesJson as unknown as { cases: RawCase[] }).cases;

export interface CaseOutcome {
  id: string;
  expectedOverall: OverallVerdict;
  actualOverall: OverallVerdict;
  /** Expected per-field statuses (only the fields this case labels). */
  expectedFields: Partial<Record<FieldKey, FieldStatus>>;
  /** Actual per-field statuses (only the fields the comparison actually produced). */
  actualFields: Partial<Record<FieldKey, FieldStatus>>;
  /** Per-field read confidence (0..1) the gate evaluated, for calibration. Only the fields that ran. */
  fieldConfidence: Partial<Record<FieldKey, number>>;
  latencyMs: number;
}

export interface PrecisionRecall {
  precision: number | null; // null when nothing was predicted for this class
  recall: number | null; // null when there were no expected instances of this class
  support: number; // number of expected instances
}

/** One reliability bin for the ECE table: a predicted-confidence band, its mean confidence + accuracy. */
export interface CalibrationBin {
  lo: number;
  hi: number;
  count: number;
  meanConfidence: number;
  accuracy: number;
}

export interface Calibration {
  /** Brier score: mean (confidence − correct)² over every scored (case, field). Lower is better; 0 = perfect. */
  brier: number | null;
  /** Expected Calibration Error: support-weighted mean |mean-confidence − accuracy| across the bins. Lower is better. */
  ece: number | null;
  /** Number of (case, field) confidence/correctness pairs the metric is computed over. */
  count: number;
  bins: CalibrationBin[];
}

export interface EvalReport {
  cases: CaseOutcome[];
  /** verdict -> P/R over the overall verdict. */
  overall: Record<OverallVerdict, PrecisionRecall>;
  /** field -> status -> P/R over per-field statuses. */
  perField: Record<FieldKey, Record<FieldStatus, PrecisionRecall>>;
  /** Confidence calibration (Brier + ECE) over the per-field read confidences vs correctness. */
  calibration: Calibration;
  approvePrecision: number; // 1 when no approvals were made (no false approvals possible)
  approvePrecisionFloor: number;
  passesFloor: boolean;
  overallAccuracy: number;
  latency: { p50: number; p95: number; count: number };
}

function buildClaimed(c: RawCase): ClaimedFields {
  // `beverageClass` is deliberately NOT forwarded (kept undefined) so the class resolution under test
  // is the one the comparator derives from the classType TEXT — the production path. The allocation
  // fields (name/fancifulName/statementOfComposition) ARE forwarded so their comparison actually runs
  // on the fixtures that supply them; unset fields stay undefined and their comparison is just skipped.
  return {
    brand: c.claimed.brand,
    classType: c.claimed.classType,
    alcoholContentText: c.claimed.alcoholContent,
    netContents: c.claimed.netContents,
    name: c.claimed.name,
    address: c.claimed.address,
    countryOfOrigin: c.claimed.countryOfOrigin,
    fancifulName: c.claimed.fancifulName,
    statementOfComposition: c.claimed.statementOfComposition,
  };
}

function precisionRecall(correct: number, predicted: number, expected: number): PrecisionRecall {
  return {
    precision: predicted === 0 ? null : correct / predicted,
    recall: expected === 0 ? null : correct / expected,
    support: expected,
  };
}


/**
 * Ten equal-width reliability bins over [0,1]; bin i covers (i/10, (i+1)/10] EXCEPT the lowest bin,
 * which is closed on the left ([0, 0.1]) so a confidence of exactly 0 (a field we couldn't read, gated
 * to `review` at confidence 0) lands in a bin. The bins therefore partition every sample (they always
 * sum to the sample count).
 */
function eceBins(samples: { confidence: number; correct: boolean }[]): CalibrationBin[] {
  const BIN_COUNT = 10;
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < BIN_COUNT; i++) {
    const lo = i / BIN_COUNT;
    const hi = (i + 1) / BIN_COUNT;
    const inBin = samples.filter((s) => (i === 0 ? s.confidence >= lo : s.confidence > lo) && s.confidence <= hi);
    const count = inBin.length;
    const meanConfidence = count === 0 ? 0 : inBin.reduce((a, s) => a + s.confidence, 0) / count;
    const accuracy = count === 0 ? 0 : inBin.filter((s) => s.correct).length / count;
    bins.push({ lo, hi, count, meanConfidence, accuracy });
  }
  return bins;
}

/** Brier score + ECE over the (confidence, correct) pairs. Null metrics when there are no samples. */
function computeCalibration(samples: { confidence: number; correct: boolean }[]): Calibration {
  const bins = eceBins(samples);
  if (samples.length === 0) return { brier: null, ece: null, count: 0, bins };
  const brier =
    samples.reduce((a, s) => a + (s.confidence - (s.correct ? 1 : 0)) ** 2, 0) / samples.length;
  const ece = bins.reduce(
    (a, b) => a + (b.count / samples.length) * Math.abs(b.meanConfidence - b.accuracy),
    0,
  );
  return { brier, ece, count: samples.length, bins };
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
    const actualFields: Partial<Record<FieldKey, FieldStatus>> = {};
    const fieldConfidence: Partial<Record<FieldKey, number>> = {};
    if (!outcome.readable || !outcome.result) {
      // Unreadable -> re-upload. Counts as "review" (a human must look), never "approve". The three
      // CFR-core checks each route to "review" (the re-upload path); the four allocation fields didn't
      // run, so they stay unset (and are simply not scored). No confidence is asserted for calibration.
      actualOverall = "review";
      actualFields.brand = "review";
      actualFields.alcohol = "review";
      actualFields.warning = "review";
    } else {
      // The PRODUCTION headline verdict gates the 3-check result on per-type completeness.
      const combined = combinedVerdict(claimed, outcome.extracted);
      actualOverall = combined.overall ?? "review";
      // The three CFR-core checks come off the named accessors; the four allocation fields come off the
      // ordered `fields` list (present only when the application supplied that field). Per-field metrics
      // stay on the claimed-vs-label comparison; the completeness gate is reflected only in the OVERALL
      // headline, not in these field statuses.
      const setField = (k: FieldKey, status: FieldStatus, conf: number | undefined): void => {
        actualFields[k] = status;
        if (typeof conf === "number") fieldConfidence[k] = conf;
      };
      setField("brand", outcome.result.brand.status, outcome.result.brand.readConfidence);
      setField("alcohol", outcome.result.alcohol.status, outcome.result.alcohol.readConfidence);
      setField("warning", outcome.result.warning.status, outcome.result.warning.readConfidence);
      for (const f of outcome.result.fields) {
        if ((EXTRA_FIELDS as readonly string[]).includes(f.key)) {
          setField(f.key as FieldKey, f.status, f.readConfidence);
        }
      }
    }

    cases.push({
      id: c.id,
      expectedOverall: c.expected.overall,
      actualOverall,
      expectedFields: c.expected.perField,
      actualFields,
      fieldConfidence,
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

  // Per-field, per-status precision/recall. A field is scored on a case only when the case LABELS an
  // expected status for it (the four allocation fields are labeled selectively), so unrelated cases
  // don't dilute the support counts.
  const perField = {} as Record<FieldKey, Record<FieldStatus, PrecisionRecall>>;
  for (const f of FIELDS) {
    perField[f] = {} as Record<FieldStatus, PrecisionRecall>;
    const labeled = cases.filter((c) => c.expectedFields[f] !== undefined);
    for (const s of STATUSES) {
      const predicted = labeled.filter((c) => c.actualFields[f] === s).length;
      const expected = labeled.filter((c) => c.expectedFields[f] === s).length;
      const correct = labeled.filter((c) => c.actualFields[f] === s && c.expectedFields[f] === s).length;
      perField[f][s] = precisionRecall(correct, predicted, expected);
    }
  }

  // Calibration: one (confidence, correct) pair per scored (case, field). "correct" = the actual status
  // matched the labeled expectation; the confidence is the read confidence the gate evaluated. Honest
  // about the mock: these confidences are the fixtures' canned per-field values (a live provider's would
  // differ), so this calibrates the HARNESS over the fixtures, not a live model. See the fixtures README.
  const calibrationSamples: { confidence: number; correct: boolean }[] = [];
  for (const c of cases) {
    for (const f of FIELDS) {
      const expected = c.expectedFields[f];
      const actual = c.actualFields[f];
      const conf = c.fieldConfidence[f];
      if (expected === undefined || actual === undefined || typeof conf !== "number") continue;
      calibrationSamples.push({ confidence: conf, correct: actual === expected });
    }
  }
  const calibration = computeCalibration(calibrationSamples);

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
    calibration,
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

function num3(v: number | null): string {
  return v === null ? "  — " : v.toFixed(3);
}

/** Render the report as a human-readable table (used by the CLI; testable). */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push("TTB Label Verifier — evaluation (mock provider, offline)");
  lines.push("=".repeat(64));
  lines.push("");
  lines.push("Per-field precision / recall (support = # expected):");
  lines.push("  field                    status   precision   recall   support");
  for (const f of FIELDS) {
    for (const s of STATUSES) {
      const pr = report.perField[f][s];
      lines.push(
        `  ${f.padEnd(23)} ${s.padEnd(8)} ${pct(pr.precision).padStart(8)} ${pct(pr.recall).padStart(8)}   ${String(pr.support).padStart(3)}`,
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
  lines.push("Confidence calibration (per-field read confidence vs correctness):");
  lines.push(
    `  Brier ${num3(report.calibration.brier)}   ECE ${num3(report.calibration.ece)}   ` +
      `(over ${report.calibration.count} field reads; lower is better, 0 = perfect)`,
  );
  lines.push("  reliability bins (conf band -> mean conf / accuracy / n):");
  for (const b of report.calibration.bins) {
    if (b.count === 0) continue;
    lines.push(
      `    ${b.lo.toFixed(1)}-${b.hi.toFixed(1)}  conf ${pct(b.meanConfidence).padStart(7)}  ` +
        `acc ${pct(b.accuracy).padStart(7)}  n=${b.count}`,
    );
  }
  lines.push(
    "  NOTE: the mock replays the fixtures' canned confidences, so this calibrates the HARNESS over the",
  );
  lines.push("  fixtures, not a live model — it shows whether confident reads are in fact correct here.");
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
