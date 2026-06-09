// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ConfirmPanel } from "./ConfirmPanel";
import { confirmVerdict } from "@/compare";
import { CANONICAL_GOVERNMENT_WARNING, type ExtractedFields } from "@/domain";

afterEach(cleanup);

function spirits(o: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brand: "Old Tom Distillery", classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)", netContents: "750 mL",
    name: "Old Tom Distillery", address: "Louisville, KY",
    warningText: CANONICAL_GOVERNMENT_WARNING, warningPrefixIsAllCaps: true, warningPrefixIsBold: true,
    confidence: { brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96, name: 0.95, address: 0.95, warningText: 0.96 },
    ...o,
  };
}
const cbs = { onAccept: vi.fn(), onEdit: vi.fn(), onMarkMissing: vi.fn(), onClassChange: vi.fn() };

describe("ConfirmPanel", () => {
  it("hoists a flagged (low-confidence) field into a 'Needs your check' group and withholds the verdict word", () => {
    const e = spirits({ confidence: { ...spirits().confidence, brand: 0.4 } });
    const q = within(render(<ConfirmPanel verdict={confirmVerdict(e, {})} {...cbs} />).container);
    expect(q.getByText("Needs your check")).toBeTruthy();
    expect(q.queryByText("Approve")).toBeNull();
  });

  it("shows the Approve verdict once nothing needs a check", () => {
    const q = within(render(<ConfirmPanel verdict={confirmVerdict(spirits(), {})} {...cbs} />).container);
    expect(q.getByText("Approve")).toBeTruthy();
  });

  it("renders an accessible beverage-type selector defaulted to the AI's class", () => {
    const q = within(render(<ConfirmPanel verdict={confirmVerdict(spirits(), {})} {...cbs} />).container);
    const select = q.getByLabelText("Beverage type") as HTMLSelectElement;
    expect(select.value).toBe("distilledSpirits");
    expect(q.getByText("Other / not sure")).toBeTruthy();
  });

  it("calls onClassChange when the reviewer picks a different type", () => {
    const onClassChange = vi.fn();
    const q = within(render(<ConfirmPanel verdict={confirmVerdict(spirits(), {})} {...cbs} onClassChange={onClassChange} />).container);
    fireEvent.change(q.getByLabelText("Beverage type"), { target: { value: "wine" } });
    expect(onClassChange).toHaveBeenCalledWith("wine");
  });
});
