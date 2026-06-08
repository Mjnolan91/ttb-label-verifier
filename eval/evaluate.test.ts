/**
 * evaluate.test.ts — runs the eval harness in CI (offline) and asserts the pipeline is
 * correct on every labeled fixture, the approve-precision floor holds, and the unreadable case is
 * never approved.
 */
import { describe, it, expect } from "vitest";
import { runEval, formatReport, APPROVE_PRECISION_FLOOR } from "./evaluate";

const FIELDS = ["brand", "alcohol", "warning"] as const;

describe("eval harness over the labeled fixtures", () => {
  it("every fixture's overall verdict matches its label", async () => {
    const report = await runEval();
    for (const c of report.cases) {
      expect(c.actualOverall, `overall for ${c.id}`).toBe(c.expectedOverall);
    }
  });

  it("every fixture's per-field statuses match their labels", async () => {
    const report = await runEval();
    for (const c of report.cases) {
      for (const f of FIELDS) {
        expect(c.actualFields[f], `${c.id}.${f}`).toBe(c.expectedFields[f]);
      }
    }
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

  it("reports latency percentiles and renders a table", async () => {
    const report = await runEval();
    expect(report.latency.count).toBe(report.cases.length);
    const table = formatReport(report);
    expect(table).toContain("Per-field precision / recall");
    expect(table).toContain("APPROVE precision");
  });
});
