/**
 * evaluate.test.ts — runs the eval harness in CI (offline) and asserts the pipeline is
 * correct on every labeled fixture, the approve-precision floor holds, the unreadable case is
 * never approved, the per-field allocation metrics match, and calibration is reported.
 */
import { describe, it, expect } from "vitest";
import { runEval, formatReport, APPROVE_PRECISION_FLOOR } from "./evaluate";

/** Every field the eval scores (the 3 CFR-core checks + the 4 completeness-driving allocation fields). */
const SCORED_FIELDS = [
  "brand",
  "alcohol",
  "warning",
  "classType",
  "netContents",
  "fancifulName",
  "statementOfComposition",
] as const;

describe("eval harness over the labeled fixtures", () => {
  it("every fixture's overall verdict matches its label", async () => {
    const report = await runEval();
    for (const c of report.cases) {
      expect(c.actualOverall, `overall for ${c.id}`).toBe(c.expectedOverall);
    }
  });

  it("every labeled per-field status matches (core + allocation fields)", async () => {
    const report = await runEval();
    for (const c of report.cases) {
      for (const f of SCORED_FIELDS) {
        const expected = c.expectedFields[f];
        if (expected === undefined) continue; // field not labeled on this case -> not scored
        expect(c.actualFields[f], `${c.id}.${f}`).toBe(expected);
      }
    }
  });

  it("scores the four allocation fields (classType / netContents / fancifulName / statementOfComposition)", async () => {
    const report = await runEval();
    // Each allocation field is exercised by at least one fixture (positive support).
    for (const f of ["classType", "netContents", "fancifulName", "statementOfComposition"] as const) {
      const totalSupport = (["pass", "review", "fail"] as const).reduce(
        (a, s) => a + report.perField[f][s].support,
        0,
      );
      expect(totalSupport, `support for ${f}`).toBeGreaterThan(0);
    }
    // The negative-allocation fixtures are present and approve cleanly.
    for (const id of [
      "puffery-excluded-rum-approve",
      "producer-acronym-brand-approve",
      "specialty-spiced-rum-approve",
    ]) {
      const c = report.cases.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect(c?.actualOverall, id).toBe("approve");
    }
    // The producer-acronym fixture's load-bearing assertion: the FULL producer name allocated as the
    // brand passes (an acronym-only allocation would have failed).
    const acr = report.cases.find((x) => x.id === "producer-acronym-brand-approve");
    expect(acr?.actualFields.brand).toBe("pass");
    // The specialty fixture exercises BOTH the fanciful-name and statement-of-composition comparators.
    const spec = report.cases.find((x) => x.id === "specialty-spiced-rum-approve");
    expect(spec?.actualFields.fancifulName).toBe("pass");
    expect(spec?.actualFields.statementOfComposition).toBe("pass");
  });

  it("meets the approve-precision floor (no false approvals)", async () => {
    const report = await runEval();
    expect(report.approvePrecision).toBeGreaterThanOrEqual(APPROVE_PRECISION_FLOOR);
    expect(report.passesFloor).toBe(true);
  });

  it("never auto-approves the unreadable / low-confidence case", async () => {
    const report = await runEval();
    const unreadable = report.cases.find((c) => c.id === "unreadable-low-confidence-review");
    expect(unreadable).toBeDefined();
    expect(unreadable?.actualOverall).not.toBe("approve");
    expect(unreadable?.actualOverall).toBe("review");
  });

  it("reports calibration (Brier + ECE) over the per-field confidences", async () => {
    const report = await runEval();
    const { brier, ece, count, bins } = report.calibration;
    expect(count).toBeGreaterThan(0);
    expect(brier).not.toBeNull();
    expect(ece).not.toBeNull();
    // Honest bounds: Brier and ECE live in [0,1]; on these high-confidence, all-correct fixtures they
    // are small but NONZERO (the canned confidences sit below 1.0), which is the point of measuring it.
    expect(brier as number).toBeGreaterThanOrEqual(0);
    expect(brier as number).toBeLessThanOrEqual(1);
    expect(brier as number).toBeGreaterThan(0);
    expect(ece as number).toBeGreaterThanOrEqual(0);
    expect(ece as number).toBeLessThanOrEqual(1);
    // The bins partition the samples: their counts sum to the sample count.
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(count);
  });

  it("reports latency percentiles and renders a table", async () => {
    const report = await runEval();
    expect(report.latency.count).toBe(report.cases.length);
    const table = formatReport(report);
    expect(table).toContain("Per-field precision / recall");
    expect(table).toContain("APPROVE precision");
    expect(table).toContain("Confidence calibration");
    expect(table).toContain("Brier");
    expect(table).toContain("ECE");
    // The new allocation fields appear in the rendered per-field table.
    expect(table).toContain("classType");
    expect(table).toContain("statementOfComposition");
  });
});
