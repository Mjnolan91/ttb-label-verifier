// @vitest-environment jsdom
/**
 * ResultView.test.tsx — the claimed-vs-label cards use plain language (Match / Needs review / No
 * match) consistent with the headline verdict, never the raw PASS/REVIEW/FAIL enum tokens (so a
 * non-technical agent never has to mentally map FAIL=Reject on the same screen).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { ResultView } from "./ResultView";
import type { VerifyResult } from "@/compare";

afterEach(cleanup);

const field = (status: "pass" | "review" | "fail") => ({
  status,
  claimed: "x",
  extracted: "x",
  reason: "because",
});

function verifyResult(overall: VerifyResult["overall"], brand: "pass" | "review" | "fail"): VerifyResult {
  return { overall, brand: field(brand), alcohol: field("pass"), warning: field("pass") };
}

describe("ResultView — plain field labels", () => {
  it("labels a failing field 'No match', never the raw 'FAIL' token", () => {
    const q = within(render(<ResultView result={verifyResult("reject", "fail")} />).container);
    expect(q.getByText("No match")).toBeTruthy();
    expect(q.queryByText("FAIL")).toBeNull();
  });

  it("labels passing fields 'Match' and keeps the headline as the human verdict word", () => {
    const q = within(render(<ResultView result={verifyResult("approve", "pass")} />).container);
    expect(q.getAllByText("Match").length).toBeGreaterThan(0);
    expect(q.getByText("Approve")).toBeTruthy();
    expect(q.queryByText("PASS")).toBeNull();
  });
});
