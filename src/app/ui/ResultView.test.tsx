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

  it("renders a confidence-gated MATCH as a calm 'confirm photo' state, distinct from a discrepancy", () => {
    const gatedBrand: VerifyField = {
      key: "brand",
      label: "Brand name",
      status: "review",
      valueStatus: "pass",
      gatedByConfidence: true,
      readConfidence: 0.67,
      claimed: "MALT & HOP BREWERY",
      extracted: "MALT & HOP BREWERY",
      reason:
        "Brand matches after normalizing case, spacing and smart quotes. We're only 67% sure we read this off the photo — open the label image to confirm before approving.",
    };
    const q = within(
      render(<ResultView result={makeResult([gatedBrand, CORE[1], CORE[2]], "review")} overall="review" />).container,
    );
    // The distinct fourth-state badge — NOT the orange "Needs review" a real mismatch gets.
    expect(q.getByText("Match · confirm photo")).toBeTruthy();
    // The read confidence is visible as a number, on the card, at the point of confusion.
    expect(q.getByText("67% read")).toBeTruthy();
    // The headline reassures (values matched; just confirm the photo) rather than alarming.
    expect(q.getByText(/Everything you entered matched/)).toBeTruthy();
  });

  it("shows a 'View label photo' affordance on a gated field when onViewImage is wired", () => {
    const gatedBrand: VerifyField = {
      key: "brand",
      label: "Brand name",
      status: "review",
      valueStatus: "pass",
      gatedByConfidence: true,
      readConfidence: 0.67,
      claimed: "MALT & HOP BREWERY",
      extracted: "MALT & HOP BREWERY",
      reason: "Brand matches. We're only 67% sure we read this off the photo — open the label image to confirm.",
    };
    const q = within(
      render(
        <ResultView
          result={makeResult([gatedBrand, CORE[1], CORE[2]], "review")}
          overall="review"
          onViewImage={() => {}}
        />,
      ).container,
    );
    expect(q.getAllByText("View label photo").length).toBeGreaterThan(0);
  });
});
