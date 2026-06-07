/**
 * tolerances.test.ts — selectToleranceFor for EACH beverage class, plus the
 * classType -> tolerance coupling and the asymmetric-boundary metadata.
 */

import { describe, it, expect } from "vitest";
import { selectToleranceFor, TOLERANCE_TABLE } from "./tolerances";
import type { BeverageClass } from "./types";

describe("selectToleranceFor — per-class CFR tolerance values", () => {
  it("distilled spirits = +/-0.3 pp (27 CFR 5.65(c))", () => {
    const rule = selectToleranceFor("distilledSpirits");
    expect(rule.value).toBe(0.3);
    expect(rule.cfrCitation).toContain("5.65");
    expect(rule.boundaryNote).toBeNull();
  });

  it("wine <=14% = +/-1.5 pp (27 CFR 4.36(b)(1)) with the 14% boundary clamp", () => {
    const rule = selectToleranceFor("wineUnder14");
    expect(rule.value).toBe(1.5);
    expect(rule.cfrCitation).toContain("4.36");
    expect(rule.boundaryNote).toContain("4.36(c)");
    expect(rule.boundaryNote).toContain("14%");
  });

  it("wine >14% = +/-1.0 pp (27 CFR 4.36(b)(1)) with the 14% boundary clamp", () => {
    const rule = selectToleranceFor("wineOver14");
    expect(rule.value).toBe(1.0);
    expect(rule.cfrCitation).toContain("4.36");
    expect(rule.boundaryNote).toContain("4.36(c)");
  });

  it("malt beverage = +/-0.3 pp (27 CFR 7.65) with the 0.5%/2.5% absolute limits", () => {
    const rule = selectToleranceFor("maltBeverage");
    expect(rule.value).toBe(0.3);
    expect(rule.cfrCitation).toContain("7.65");
    expect(rule.boundaryNote).toContain("0.5%");
    expect(rule.boundaryNote).toContain("2.5%");
  });

  it("cider resolves to the wine <=14% rule (+/-1.5 pp) by default", () => {
    const rule = selectToleranceFor("cider");
    expect(rule.value).toBe(1.5);
    // Default resolution is wine (Part 4); malt-based cider is classified upstream instead.
    expect(rule.boundaryNote).toContain("malt");
  });

  it("unknown uses the tightest conservative band (+/-0.3 pp) and is not a CFR tolerance", () => {
    const rule = selectToleranceFor("unknown");
    expect(rule.value).toBe(0.3);
    expect(rule.cfrCitation).toContain("n/a");
  });
});

describe("classType -> tolerance coupling", () => {
  it("the class is the input that selects the rule (rule reports its own class)", () => {
    const classes: BeverageClass[] = [
      "distilledSpirits",
      "wineUnder14",
      "wineOver14",
      "maltBeverage",
      "cider",
      "unknown",
    ];
    for (const c of classes) {
      expect(selectToleranceFor(c).beverageClass).toBe(c);
    }
  });

  it("different classes can yield different tolerances for the same labeled ABV", () => {
    // Spirits (0.3) is strictly tighter than table wine (1.5): the class, not the number,
    // decides whether a given actual ABV is in tolerance.
    expect(selectToleranceFor("distilledSpirits").value).toBeLessThan(
      selectToleranceFor("wineUnder14").value,
    );
  });

  it("the table has exactly one entry per beverage class", () => {
    expect(Object.keys(TOLERANCE_TABLE).sort()).toEqual(
      [
        "cider",
        "distilledSpirits",
        "maltBeverage",
        "unknown",
        "wineOver14",
        "wineUnder14",
      ].sort(),
    );
  });
});
