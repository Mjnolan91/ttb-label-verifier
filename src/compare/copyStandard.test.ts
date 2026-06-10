/**
 * copyStandard.test.ts — no em/en dashes in rendered verdict copy (project copy standard).
 *
 * The per-component guards (FieldHelp, HelpButton, DecisionPanel) cover static UI copy, but the
 * strings users read most are PRODUCED here in the compare layer: completeness element details and
 * comparator reasons. This guard drives the producers through the paths that historically carried
 * em dashes (unverifiable warning typography notes, the unknown-class tolerance citation) and
 * asserts the project standard over everything they emit.
 */
import { describe, expect, it } from "vitest";
import { checkCompleteness } from "./completeness";
import { compareAlcohol } from "./comparators";
import { CANONICAL_GOVERNMENT_WARNING, type ExtractedFields } from "@/domain";

const NO_DASHES = (s: string | undefined, context: string) => {
  expect(s ?? "", context).not.toMatch(/[–—]/); // en dash, em dash
};

function extractedWith(overrides: Partial<ExtractedFields>): ExtractedFields {
  return {
    brand: "Old Tom Distillery",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: null,
    warningPrefixIsBold: null,
    warningRemainderIsBold: null,
    warningIsReadilyLegible: false,
    confidence: { brand: 1, classType: 1, alcoholContent: 1, netContents: 1, warningText: 1 },
    ...overrides,
  } as ExtractedFields;
}

describe("compare-layer copy standard — no em/en dashes in produced strings", () => {
  it("completeness details (incl. the unverifiable caps/bold and legibility confirm-notes)", () => {
    const result = checkCompleteness(extractedWith({}));
    for (const el of result.elements) {
      NO_DASHES(el.detail, `completeness detail for ${el.key}`);
      NO_DASHES(el.label, `completeness label for ${el.key}`);
    }
  });

  it("alcohol comparison reasons (incl. the unknown-class product-default citation)", () => {
    // Unknown class: no class supplied anywhere -> the product-default tightest band's citation
    // renders into the reason. In-tolerance and out-of-tolerance both produce user-facing copy.
    for (const extractedText of ["40.2% Alc./Vol.", "41.2% Alc./Vol."]) {
      const r = compareAlcohol({ claimedText: "40% Alc./Vol.", extractedText });
      NO_DASHES(r.reason, `alcohol reason for ${extractedText}`);
    }
  });
});
