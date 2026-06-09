import { describe, it, expect } from "vitest";
import { CLASS_CHOICES, CLASS_CHOICE_LABEL, coarseClassOf } from "./beverageClass";

describe("beverage-class selector model", () => {
  it("offers the five coarse choices in order, ending with the 'unknown' fallback", () => {
    expect(CLASS_CHOICES).toEqual(["distilledSpirits", "wine", "maltBeverage", "cider", "unknown"]);
    expect(CLASS_CHOICE_LABEL.unknown).toBe("Other / not sure");
    expect(CLASS_CHOICE_LABEL.wine).toBe("Wine");
  });

  it("collapses both wine tiers to the single 'wine' choice", () => {
    expect(coarseClassOf("wineUnder14")).toBe("wine");
    expect(coarseClassOf("wineOver14")).toBe("wine");
  });

  it("maps the other fine classes 1:1", () => {
    expect(coarseClassOf("distilledSpirits")).toBe("distilledSpirits");
    expect(coarseClassOf("maltBeverage")).toBe("maltBeverage");
    expect(coarseClassOf("cider")).toBe("cider");
    expect(coarseClassOf("unknown")).toBe("unknown");
  });
});
