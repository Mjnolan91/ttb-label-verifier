/**
 * alcohol.test.ts — free-text alcohol parsing + beverage-class resolution.
 */
import { describe, it, expect } from "vitest";
import {
  parseAlcoholText,
  resolveBeverageClass,
  isLowOrReducedAlcoholClaim,
} from "./alcohol";

describe("parseAlcoholText", () => {
  it("parses ABV and proof from a full statement", () => {
    expect(parseAlcoholText("45% Alc./Vol. (90 Proof)")).toEqual({ abv: 45, proof: 90 });
  });
  it("parses ABV with proof ABSENT (proof optional)", () => {
    expect(parseAlcoholText("45% Alc./Vol.")).toEqual({ abv: 45, proof: undefined });
  });
  it("parses a decimal ABV (no proof)", () => {
    expect(parseAlcoholText("13.5% ABV")).toEqual({ abv: 13.5, proof: undefined });
  });
  it("parses a European comma decimal without truncating it", () => {
    expect(parseAlcoholText("13,5% Alc./Vol.")).toEqual({ abv: 13.5, proof: undefined });
  });
  it("parses a %-less ABV via the number-then-abv/alc fallback", () => {
    expect(parseAlcoholText("40 ABV").abv).toBe(40);
    expect(parseAlcoholText("13.5 alc").abv).toBe(13.5);
  });
  it("parses a proof-only statement (abv undefined)", () => {
    expect(parseAlcoholText("(90 Proof)")).toEqual({ abv: undefined, proof: 90 });
  });
  it("returns empty for missing/garbled text", () => {
    expect(parseAlcoholText("")).toEqual({});
    expect(parseAlcoholText(undefined)).toEqual({});
  });

  it("anchors to the alcohol cue, ignoring a non-alcohol percentage that appears first", () => {
    // The false-approval class: a tequila label prints "100% Agave" before the real ABV. A
    // first-percentage parse would read 100 and (claimed 100 vs labeled 100) approve a wrong value.
    expect(parseAlcoholText("100% Agave. 40% Alc./Vol. (80 Proof)")).toEqual({ abv: 40, proof: 80 });
    expect(parseAlcoholText("100% Blue Agave 40% Alc./Vol.").abv).toBe(40);
  });
  it("anchors when the cue comes BEFORE the number (ABV: 5.5%) even with a leading 100% juice", () => {
    expect(parseAlcoholText("100% Juice. ABV: 5.5%").abv).toBe(5.5);
    expect(parseAlcoholText("Alcohol 5.5% by volume").abv).toBe(5.5);
  });
  it("uses a bare percentage only when no alcohol cue is present", () => {
    expect(parseAlcoholText("40%").abv).toBe(40);
  });
  it("treats 0% as a real value (non-alcoholic / <0.5% warning exemption needs a real 0)", () => {
    expect(parseAlcoholText("0.0% Alc./Vol.").abv).toBe(0);
  });
  it("discards physically-impossible values so garbage cannot pose as an ABV", () => {
    expect(parseAlcoholText("-5% ABV").abv).toBeUndefined(); // negative -> not a real reading
    expect(parseAlcoholText("999999% ABV").abv).toBeUndefined(); // > 100 -> not a real reading
  });
});

describe("resolveBeverageClass (class text -> BeverageClass enum)", () => {
  it("maps the fixture's class strings to distilled spirits", () => {
    expect(resolveBeverageClass("distilled-spirits")).toBe("distilledSpirits");
    expect(resolveBeverageClass("Distilled spirits")).toBe("distilledSpirits");
    expect(resolveBeverageClass("Kentucky Straight Bourbon Whiskey")).toBe("distilledSpirits");
  });
  it("splits wine by ABV at the 14% boundary", () => {
    expect(resolveBeverageClass("Table Wine", 12)).toBe("wineUnder14");
    expect(resolveBeverageClass("Table Wine", 16)).toBe("wineOver14");
    expect(resolveBeverageClass("Wine")).toBe("wineUnder14"); // default when ABV unknown
  });
  it("maps beer/ale to malt beverage and cider to cider", () => {
    expect(resolveBeverageClass("India Pale Ale")).toBe("maltBeverage");
    expect(resolveBeverageClass("Lager")).toBe("maltBeverage");
    expect(resolveBeverageClass("Hard Cider")).toBe("cider");
  });
  it("falls back to unknown for unrecognized/empty class text", () => {
    expect(resolveBeverageClass("")).toBe("unknown");
    expect(resolveBeverageClass(undefined)).toBe("unknown");
    expect(resolveBeverageClass("Mystery Beverage")).toBe("unknown");
  });
});

describe("isLowOrReducedAlcoholClaim", () => {
  it("detects low/reduced alcohol claims", () => {
    expect(isLowOrReducedAlcoholClaim("Low Alcohol Beer")).toBe(true);
    expect(isLowOrReducedAlcoholClaim("Reduced-Alcohol Malt Beverage")).toBe(true);
  });
  it("is false otherwise", () => {
    expect(isLowOrReducedAlcoholClaim("India Pale Ale")).toBe(false);
    expect(isLowOrReducedAlcoholClaim(undefined)).toBe(false);
  });
});
