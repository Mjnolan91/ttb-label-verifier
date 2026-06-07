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
  it("returns empty for missing/garbled text", () => {
    expect(parseAlcoholText("")).toEqual({});
    expect(parseAlcoholText(undefined)).toEqual({});
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
