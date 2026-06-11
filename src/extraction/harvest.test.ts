/**
 * harvest.test.ts — deterministic origin harvesting. Vision samples allocate a printed origin
 * statement ("SPARKLING WINE - PRODUCT OF FRANCE") inconsistently across fields run to run, so the
 * SAME label oscillates between "origin missing" and "origin present" on sampling noise. The harvest
 * is plain code, not another model call: when countryOfOrigin came back empty but a sibling field's
 * text contains an origin-marking phrase that NAMES a country, copy that span over. It only ever
 * surfaces text that was confidently read off the label — it can never invent a country.
 */
import { describe, expect, it } from "vitest";
import { harvestOriginStatement } from "./harvest";
import type { ExtractedFields } from "@/domain";

function fields(partial: Partial<ExtractedFields>): ExtractedFields {
  return { warningPrefixIsAllCaps: false, warningPrefixIsBold: null, confidence: {}, ...partial };
}

describe("harvestOriginStatement", () => {
  it("copies a printed PRODUCT OF <country> span from the commodity statement into countryOfOrigin", () => {
    const e = fields({
      commodityStatement: "SPARKLING WINE - PRODUCT OF FRANCE",
      confidence: { commodityStatement: 0.9 },
    });
    const out = harvestOriginStatement(e);
    expect(out.countryOfOrigin).toBe("PRODUCT OF FRANCE");
    expect(out.confidence.countryOfOrigin).toBe(0.9); // inherits the source read's confidence
    expect(out.commodityStatement).toBe("SPARKLING WINE - PRODUCT OF FRANCE"); // source untouched
  });

  it("never overwrites a countryOfOrigin the model already read", () => {
    const e = fields({
      countryOfOrigin: "Product of Spain",
      commodityStatement: "RED WINE - PRODUCT OF FRANCE",
      confidence: { countryOfOrigin: 0.8, commodityStatement: 0.9 },
    });
    const out = harvestOriginStatement(e);
    expect(out.countryOfOrigin).toBe("Product of Spain");
    expect(out.confidence.countryOfOrigin).toBe(0.8);
  });

  it("ignores an origin phrase that names a REGION, not a country (the law needs a named country)", () => {
    const e = fields({
      statementOfComposition: "RUM - IMPORTED FROM THE CARIBBEAN",
      confidence: { statementOfComposition: 0.9 },
    });
    const out = harvestOriginStatement(e);
    expect(out.countryOfOrigin).toBeUndefined();
  });

  it("harvests from the statement of composition too, trimming trailing separators", () => {
    const e = fields({
      statementOfComposition: "SPARKLING WINE - PRODUCT OF FRANCE | CONTAINS SULFITES",
      confidence: { statementOfComposition: 0.7 },
    });
    const out = harvestOriginStatement(e);
    expect(out.countryOfOrigin).toBe("PRODUCT OF FRANCE");
    expect(out.confidence.countryOfOrigin).toBe(0.7);
  });

  it("cuts the harvested span at a following sentence or responsibility tail", () => {
    // "PRODUCT OF FRANCE. CONTAINS SULFITES" must not drag the sulfite sentence along, and
    // "BOTTLED IN FRANCE BY MAISON X" must not carry the producer into the origin statement.
    const sentence = harvestOriginStatement(
      fields({ commodityStatement: "PRODUCT OF FRANCE. CONTAINS SULFITES", confidence: { commodityStatement: 0.9 } }),
    );
    expect(sentence.countryOfOrigin).toBe("PRODUCT OF FRANCE");
    const tail = harvestOriginStatement(
      fields({
        commodityStatement: "PRODUCED AND BOTTLED IN FRANCE BY MAISON CASSIOPEIA",
        confidence: { commodityStatement: 0.9 },
      }),
    );
    expect(tail.countryOfOrigin).toBe("BOTTLED IN FRANCE");
  });

  it("skips the harvest when the source field carries no confidence (never invents one)", () => {
    const e = fields({ commodityStatement: "SPARKLING WINE - PRODUCT OF FRANCE", confidence: {} });
    const out = harvestOriginStatement(e);
    expect(out.countryOfOrigin).toBeUndefined();
  });

  it("leaves the record unchanged when no sibling carries an origin phrase", () => {
    const e = fields({
      commodityStatement: "PRODUCED AND BOTTLED BY SA MAISON CASSIOPEIA, 51530 Cramant, France",
      confidence: { commodityStatement: 0.9 },
    });
    const out = harvestOriginStatement(e);
    // "PRODUCED AND BOTTLED BY" is a producer statement, not an origin marking; an address alone is
    // an INFERENCE (origin.ts handles that), never a printed origin statement.
    expect(out.countryOfOrigin).toBeUndefined();
  });
});
