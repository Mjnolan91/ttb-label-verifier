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

  it("NEVER reads alcohol-by-weight as ABV (4.0% ABW is ~5.0% ABV — a silent misread skews the verdict)", () => {
    // ABW-only statements must come back with NO abv, routing the field to review downstream.
    expect(parseAlcoholText("4.0% alcohol by weight").abv).toBeUndefined();
    expect(parseAlcoholText("4.0% ALC/WT").abv).toBeUndefined();
    expect(parseAlcoholText("4.0% Alc. by Wt.").abv).toBeUndefined();
    expect(parseAlcoholText("4.0% ABW").abv).toBeUndefined();
  });
  it("when BOTH by-weight and by-volume are stated, anchors to the by-volume number", () => {
    expect(parseAlcoholText("3.2% ALC/WT (4.0% ALC/VOL)").abv).toBe(4.0);
    expect(parseAlcoholText("4.0% Alc. by Vol. 3.2% Alc. by Wt.").abv).toBe(4.0);
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
  it("anchors to a cue with a wide gap instead of falling back to a bare percentage", () => {
    // "ALCOHOL BY VOLUME 4.5%" has an 11-char gap between cue and number. The bare-% last resort
    // must not grab "0%" from "0% SUGAR" — an ABV of 0 would falsely exempt a missing warning.
    expect(parseAlcoholText("ALCOHOL BY VOLUME 4.5%").abv).toBe(4.5);
    expect(parseAlcoholText("0% SUGAR. ALCOHOL BY VOLUME 4.5%").abv).toBe(4.5);
  });
  it("returns NO abv when an alcohol cue exists but no number anchors to it (never the bare %)", () => {
    // A cue is present but unparseable -> undefined routes the field to review; the bare "55%"
    // (a non-alcohol number) must not be promoted to the ABV just because the anchors missed.
    expect(parseAlcoholText("55% RYE MASH. ALCOHOL CONTENT ON NECK LABEL").abv).toBeUndefined();
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
  it("matches keywords on WORD boundaries — 'Imported X' must not resolve to wine via 'port'", () => {
    // The false-tolerance class: "imported" contains the substring "port", so substring matching
    // sent every imported spirit to the WINE tolerance band (1.5x looser than spirits).
    expect(resolveBeverageClass("Imported Vodka")).toBe("distilledSpirits");
    expect(resolveBeverageClass("Imported Gin", 40)).toBe("distilledSpirits");
    expect(resolveBeverageClass("Imported Herbal Anise Spirit", 69)).toBe("distilledSpirits");
    // The real words keep their classes.
    expect(resolveBeverageClass("Ruby Port", 20)).toBe("wineOver14");
    expect(resolveBeverageClass("Porter")).toBe("maltBeverage");
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

describe("resolveBeverageClass — adversarial audit (FN-1, FN-9)", () => {
  it("varietals and semi-generics are wine, not unknown", () => {
    expect(resolveBeverageClass("Chardonnay")).toBe("wineUnder14");
    expect(resolveBeverageClass("Pinot Noir")).toBe("wineUnder14");
    expect(resolveBeverageClass("Champagne")).toBe("wineUnder14");
    expect(resolveBeverageClass("Cabernet Sauvignon", 14.5)).toBe("wineOver14");
  });

  it("hard seltzer is a malt beverage", () => {
    expect(resolveBeverageClass("Hard Seltzer")).toBe("maltBeverage");
  });

  it("a spirit word wins over incidental beverage words (cask finishes, single malt)", () => {
    expect(resolveBeverageClass("Single Malt Scotch Whisky")).toBe("distilledSpirits");
    expect(resolveBeverageClass("Single Malt Scotch Whisky Finished in Cider Casks")).toBe("distilledSpirits");
    expect(resolveBeverageClass("Straight Bourbon Whiskey Finished in Port Casks")).toBe("distilledSpirits");
  });
});
