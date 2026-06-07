/**
 * eval/run.ts — CLI entry for `npm run eval`. Runs the offline evaluation, prints the table, and
 * exits non-zero if the approve-precision floor is breached (so it can gate CI).
 */
import { runEval, formatReport } from "./evaluate";

async function main(): Promise<void> {
  const report = await runEval();
  console.log(formatReport(report));

  if (!report.passesFloor) {
    console.error(
      `\nFAIL: approve precision ${(report.approvePrecision * 100).toFixed(1)}% is below the ` +
        `${(report.approvePrecisionFloor * 100).toFixed(1)}% floor (false approvals are unacceptable).`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("\nOK: approve-precision floor satisfied.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
