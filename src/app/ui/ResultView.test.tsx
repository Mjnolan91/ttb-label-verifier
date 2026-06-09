// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { ResultView } from "./ResultView";
import type { VerifyField, VerifyResult, OverallVerdict } from "@/compare";

afterEach(cleanup);

/** Build a VerifyResult from an ordered field list; the named accessors are derived from it. */
function makeResult(fields: VerifyField[], overall: OverallVerdict): VerifyResult {
  const byKey = (k: string) => fields.find((f) => f.key === k)!;
  return { fields, brand: byKey("brand"), alcohol: byKey("alcohol"), warning: byKey("warning"), overall };
}

const CORE: VerifyField[] = [
  { key: "brand", label: "Brand name", status: "pass", claimed: "ABC Single Barrel", extracted: "ABC Single Barrel", reason: "Brand matches." },
  { key: "alcohol", label: "Alcohol content", status: "pass", claimed: "45% Alc./Vol.", extracted: "45% Alc./Vol. (90 Proof)", reason: "Within tolerance." },
  { key: "warning", label: "Government warning", status: "pass", claimed: "", extracted: "GOVERNMENT WARNING: ...", reason: "Warning present." },
];

describe("ResultView — at-a-glance label-vs-application verdict", () => {
  it("shows the overall verdict and a claimed-vs-label card for each compared field", () => {
    const q = within(render(<ResultView result={makeResult(CORE, "approve")} />).container);
    expect(q.getByText("Approve")).toBeTruthy();
    expect(q.getByText("Brand name")).toBeTruthy();
    expect(q.getByText("Alcohol content")).toBeTruthy();
    expect(q.getByText("Government warning")).toBeTruthy();
    expect(q.getAllByText(/ABC Single Barrel/).length).toBeGreaterThan(0);
  });

  it("renders extra cards for the additional application fields (N > 3)", () => {
    const fields: VerifyField[] = [
      CORE[0],
      { key: "classType", label: "Class / type", status: "pass", claimed: "distilled-spirits", extracted: "Straight Rye Whisky", reason: "Same class." },
      CORE[1],
      { key: "netContents", label: "Net contents", status: "pass", claimed: "750 mL", extracted: "750 mL", reason: "Match." },
      CORE[2],
    ];
    const q = within(render(<ResultView result={makeResult(fields, "approve")} />).container);
    expect(q.getByText("Class / type")).toBeTruthy();
    expect(q.getByText("Net contents")).toBeTruthy();
  });

  it("prefers the gated overall when supplied (completeness can worsen the headline)", () => {
    const q = within(render(<ResultView result={makeResult(CORE, "approve")} overall="review" gatedByCompleteness />).container);
    expect(q.getByText("Needs review")).toBeTruthy();
  });

  it("reflects a per-field failure (a no-match brand)", () => {
    const failing: VerifyField[] = [
      { key: "brand", label: "Brand name", status: "fail", claimed: "ABC Single Barrel", extracted: "Totally Different Co", reason: "Brand does not match." },
      CORE[1],
      CORE[2],
    ];
    const q = within(render(<ResultView result={makeResult(failing, "reject")} />).container);
    expect(q.getByText("Reject")).toBeTruthy();
    expect(q.getByText("No match")).toBeTruthy();
  });
});
