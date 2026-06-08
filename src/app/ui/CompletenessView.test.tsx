// @vitest-environment jsdom
/**
 * CompletenessView.test.tsx — the completeness section is the headline result when no application
 * values are entered, so it must give the same plain "what do I do now" guidance the verdict banner gives.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { CompletenessView } from "./CompletenessView";
import type { CompletenessResult } from "@/compare";

afterEach(cleanup);

function result(overall: CompletenessResult["overall"]): CompletenessResult {
  return {
    beverageClass: "distilledSpirits",
    overall,
    elements: [
      {
        key: "netContents",
        label: "Net contents",
        necessity: "mandatory",
        status: overall === "complete" ? "present" : "missing",
        detail: "—",
      },
    ],
  };
}

describe("CompletenessView — next-step guidance", () => {
  it("gives an incomplete result a plain next-step line naming which rows to check", () => {
    const q = within(render(<CompletenessView completeness={result("incomplete")} />).container);
    expect(q.getByText("Incomplete")).toBeTruthy();
    expect(q.getByText(/check the rows marked MISSING or WRONG FORMAT below/i)).toBeTruthy();
  });

  it("gives a complete result a reassuring next-step line", () => {
    const q = within(render(<CompletenessView completeness={result("complete")} />).container);
    expect(q.getByText("Complete")).toBeTruthy();
    expect(q.getByText(/Every element TTB requires/i)).toBeTruthy();
  });
});
