import { describe, expect, it } from "vitest";
import { inferOrigin, isUsAddress, suggestedCountryOfOrigin } from "./origin";
import type { ExtractedFields } from "@/domain";

/** Minimal extracted shape for origin inference (only the consulted text fields). */
type Evidence = Pick<
  ExtractedFields,
  "name" | "address" | "countryOfOrigin" | "class" | "classType" | "commodityStatement"
>;
function ex(fields: Partial<Evidence>): Evidence {
  return {
    name: undefined,
    address: undefined,
    countryOfOrigin: undefined,
    class: undefined,
    classType: undefined,
    commodityStatement: undefined,
    ...fields,
  };
}

describe("isUsAddress", () => {
  it("recognizes the classic City, ST form", () => {
    expect(isUsAddress("Baltimore, MD")).toBe(true);
    expect(isUsAddress("Louisville, KY")).toBe(true);
    expect(isUsAddress("Portland, OR")).toBe(true);
  });

  it("recognizes City, ST ZIP and a trailing period", () => {
    expect(isUsAddress("Baltimore, MD 21201")).toBe(true);
    expect(isUsAddress("Baltimore, MD 21201-1234")).toBe(true);
    expect(isUsAddress("Frankfort, KY.")).toBe(true);
  });

  it("recognizes a spelled-out state after the comma", () => {
    expect(isUsAddress("Louisville, Kentucky")).toBe(true);
    expect(isUsAddress("Walla Walla, Washington")).toBe(true);
    expect(isUsAddress("Bardstown, Kentucky 40004")).toBe(true);
  });

  it("recognizes an explicit USA suffix", () => {
    expect(isUsAddress("Baltimore, MD, USA")).toBe(true);
    expect(isUsAddress("New Orleans, LA, United States")).toBe(true);
  });

  it("includes DC and the US territories TTB treats as domestic", () => {
    expect(isUsAddress("Washington, DC")).toBe(true);
    expect(isUsAddress("San Juan, PR")).toBe(true);
    expect(isUsAddress("St. Croix, VI")).toBe(true);
  });

  it("does NOT match foreign addresses or free text containing state-like letter pairs", () => {
    expect(isUsAddress("Oaxaca, Mexico")).toBe(false);
    expect(isUsAddress("Cognac, France")).toBe(false);
    expect(isUsAddress("Bridgetown, Barbados")).toBe(false);
    // "IN", "OR", "ME" are English words; without the City-comma context they must not trigger.
    expect(isUsAddress("MADE IN OAK BARRELS")).toBe(false);
    expect(isUsAddress("")).toBe(false);
    expect(isUsAddress(undefined)).toBe(false);
  });

  it("does not treat a Canadian province or lookalike as a US state", () => {
    expect(isUsAddress("Toronto, ON")).toBe(false);
    expect(isUsAddress("Vancouver, BC")).toBe(false);
  });
});

describe("inferOrigin", () => {
  it("classifies a US city/state producer address with no import statement as domestic", () => {
    expect(inferOrigin(ex({ name: "Old Tom Distillery", address: "Baltimore, MD" }))).toBe("domestic");
  });

  it("classifies a printed US origin statement as domestic", () => {
    expect(inferOrigin(ex({ countryOfOrigin: "Product of USA" }))).toBe("domestic");
    expect(inferOrigin(ex({ countryOfOrigin: "United States" }))).toBe("domestic");
  });

  it("classifies a non-US origin statement as imported", () => {
    expect(inferOrigin(ex({ countryOfOrigin: "Product of Scotland" }))).toBe("imported");
    expect(inferOrigin(ex({ countryOfOrigin: "Product of Barbados", address: "Miami, FL" }))).toBe("imported");
  });

  it("classifies an 'Imported by' statement as imported EVEN WITH a US bottler address", () => {
    // The realistic both-signals label: imported product, US importer address. Import evidence wins —
    // a wrong "domestic" here would suppress a genuinely mandatory country-of-origin statement.
    expect(
      inferOrigin(ex({ name: "Imported by Sea Trader Co.", address: "Miami, FL" })),
    ).toBe("imported");
    expect(inferOrigin(ex({ address: "Imported and bottled in Miami, FL" }))).toBe("imported");
  });

  it("does not read a company name containing 'Imports' as an import statement", () => {
    // "Sea Trader Imports" is an entity name, not the labeling phrase "imported by".
    expect(inferOrigin(ex({ name: "Sea Trader Imports", address: "Miami, FL" }))).toBe("domestic");
  });

  it("reads the commodity statement's 'IMPORTED BY' verb (extraction strips it from the name)", () => {
    expect(
      inferOrigin(ex({ name: "Sea Trader Co.", address: "Miami, FL", commodityStatement: "IMPORTED BY" })),
    ).toBe("imported");
  });

  it("treats a foreign-distinctive class designation as import evidence, even with a US bottler", () => {
    // 27 CFR 5.67(b): a US-bottled import may carry only "Bottled by X, City, ST" — the designation
    // itself (5.143(c)/5.145/5.148) is then the only import signal on the label.
    expect(inferOrigin(ex({ classType: "Scotch Whisky", address: "Baltimore, MD" }))).toBe("imported");
    expect(inferOrigin(ex({ classType: "Blended Canadian Whisky", address: "Buffalo, NY" }))).toBe("imported");
    expect(inferOrigin(ex({ classType: "Tequila", address: "San Antonio, TX" }))).toBe("imported");
    expect(inferOrigin(ex({ class: "Cognac" }))).toBe("imported");
  });

  it("does NOT treat Scotch Ale (a domestic malt style) as foreign-distinctive", () => {
    expect(inferOrigin(ex({ classType: "Scotch Ale", address: "Portland, OR" }))).toBe("domestic");
  });

  it("returns unknown when there is no evidence either way", () => {
    expect(inferOrigin(ex({}))).toBe("unknown");
    expect(inferOrigin(ex({ name: "Old Tom Distillery" }))).toBe("unknown");
    expect(inferOrigin(ex({ address: "Cognac, France" }))).toBe("unknown");
  });
});

describe("suggestedCountryOfOrigin", () => {
  it("suppresses the suggestion for a domestic product (the application field is imports-only)", () => {
    expect(
      suggestedCountryOfOrigin(ex({ countryOfOrigin: "USA", address: "Baltimore, MD" })),
    ).toBeUndefined();
    expect(
      suggestedCountryOfOrigin(ex({ countryOfOrigin: "Product of USA" })),
    ).toBeUndefined();
  });

  it("passes a genuine import statement through", () => {
    expect(suggestedCountryOfOrigin(ex({ countryOfOrigin: "Product of Scotland" }))).toBe(
      "Product of Scotland",
    );
  });

  it("suggests nothing when nothing was read", () => {
    expect(suggestedCountryOfOrigin(ex({ address: "Baltimore, MD" }))).toBeUndefined();
    expect(suggestedCountryOfOrigin(ex({}))).toBeUndefined();
  });
});
