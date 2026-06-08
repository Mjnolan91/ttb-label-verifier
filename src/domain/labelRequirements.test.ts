/**
 * labelRequirements.test.ts — the per-class TTB mandatory-element matrix.
 */
import { describe, it, expect } from "vitest";
import { mandatoryElementsFor } from "./labelRequirements";
import type { BeverageClass } from "./types";

const keysFor = (cls: BeverageClass) => mandatoryElementsFor(cls).map((s) => s.key);

describe("mandatoryElementsFor", () => {
  it("requires the common mandatory head/tail for every concrete class", () => {
    for (const cls of ["distilledSpirits", "wineUnder14", "wineOver14", "maltBeverage", "cider"] as const) {
      const keys = keysFor(cls);
      for (const k of ["brand", "classType", "netContents", "name", "address", "governmentWarning"]) {
        expect(keys).toContain(k);
      }
    }
  });

  it("includes a (conditional) country-of-origin for the unknown class, like every concrete class", () => {
    expect(keysFor("unknown")).toContain("countryOfOrigin");
    const coo = mandatoryElementsFor("unknown").find((s) => s.key === "countryOfOrigin")!;
    expect(coo.necessity).toBe("conditional");
  });

  it("models sulfite as conditional (not mandatory) on wine", () => {
    const sulfite = mandatoryElementsFor("wineUnder14").find((s) => s.key === "sulfiteDeclaration")!;
    expect(sulfite.necessity).toBe("conditional");
  });
});
