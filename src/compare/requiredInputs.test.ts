/**
 * requiredInputs.test.ts — the dynamic per-type required-input set is derived from the CFR matrix.
 * Verified against the 2026 TTB/COLA legislation audit: alcohol gates only where it is mandatory.
 */
import { describe, it, expect } from "vitest";
import { requiredInputKeysFor, classChoiceFor, CLASS_CHOICES } from "./requiredInputs";

describe("requiredInputKeysFor (dynamic, per beverage class)", () => {
  const UNIVERSAL = ["brand", "classType", "netContents", "name", "address"];

  it("requires the universal set for EVERY class (brand, class/type, net, name, address)", () => {
    for (const cls of ["distilledSpirits", "wineUnder14", "wineOver14", "maltBeverage", "cider", "unknown"] as const) {
      for (const k of UNIVERSAL) expect(requiredInputKeysFor(cls)).toContain(k);
    }
  });

  it("requires alcohol where the law makes it mandatory (spirits, wine >14%, unknown)", () => {
    expect(requiredInputKeysFor("distilledSpirits")).toContain("alcoholContent"); // 27 CFR 5.65
    expect(requiredInputKeysFor("wineOver14")).toContain("alcoholContent"); // 27 CFR 4.36(a)
    expect(requiredInputKeysFor("unknown")).toContain("alcoholContent"); // conservative
  });

  it("does NOT require alcohol where it is conditional (wine ≤14% table-wine, malt-optional, cider)", () => {
    expect(requiredInputKeysFor("wineUnder14")).not.toContain("alcoholContent"); // table-wine substitution
    expect(requiredInputKeysFor("maltBeverage")).not.toContain("alcoholContent"); // 7.63(a)(3)/7.65(a)
    expect(requiredInputKeysFor("cider")).not.toContain("alcoholContent"); // resolves to wine ≤14%
  });

  it("never includes the government warning (auto/derived, not a typed input)", () => {
    for (const cls of ["distilledSpirits", "wineUnder14", "maltBeverage"] as const) {
      expect(requiredInputKeysFor(cls)).not.toContain("governmentWarning");
    }
  });
});

describe("classChoiceFor (fine class → coarse selector choice)", () => {
  it("collapses both wine tax classes to the single 'wine' choice", () => {
    expect(classChoiceFor("wineUnder14")).toBe("wine");
    expect(classChoiceFor("wineOver14")).toBe("wine");
  });
  it("maps the other classes 1:1 and unknown to 'unknown'", () => {
    expect(classChoiceFor("distilledSpirits")).toBe("distilledSpirits");
    expect(classChoiceFor("maltBeverage")).toBe("maltBeverage");
    expect(classChoiceFor("cider")).toBe("cider");
    expect(classChoiceFor("unknown")).toBe("unknown");
  });
  it("every coarse choice has a human label", () => {
    expect(CLASS_CHOICES.map((c) => c.value)).toEqual(["distilledSpirits", "wine", "maltBeverage", "cider", "unknown"]);
    expect(CLASS_CHOICES.every((c) => c.label.length > 0)).toBe(true);
  });
});
