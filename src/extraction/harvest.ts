/**
 * harvest.ts — deterministic post-merge field harvesting (plain code, never another model call).
 *
 * The vision samples allocate a printed origin statement ("SPARKLING WINE - PRODUCT OF FRANCE")
 * inconsistently across fields run to run: sometimes countryOfOrigin, sometimes the commodity
 * statement or statement of composition. The SAME label then oscillates between "origin missing"
 * (a completeness flag on an import) and "origin present" purely on sampling noise — observed live
 * in the 2026-06-10 batch-distrust investigation. When countryOfOrigin came back EMPTY but a
 * sibling field's confidently-read text contains an origin-marking phrase that NAMES a country
 * (namedCountryIn — a region like "the Caribbean" never qualifies), copy that span over, inheriting
 * the source field's confidence. The harvest only ever surfaces text the model already read off the
 * label; it cannot invent a country, and it never overwrites a value the model allocated itself.
 */
import type { ExtractedFields } from "@/domain";
import { namedCountryIn } from "@/compare";

/** The origin-marking lead-ins worth harvesting (mirrors origin.ts's ORIGIN_PREFIX, mid-text). */
const ORIGIN_SPAN = /\b(?:product of|produce of|made in|bottled in|imported from)\s+[^|;,/]+/i;

/** Sibling fields a misallocated origin statement realistically lands in. The importer statement is
 *  deliberately excluded: "IMPORTED BY <U.S. importer>" names the importer, not the origin. */
const HARVEST_SOURCES = [
  { key: "commodityStatement", confKey: "commodityStatement" },
  { key: "statementOfComposition", confKey: "statementOfComposition" },
] as const;

export function harvestOriginStatement(e: ExtractedFields): ExtractedFields {
  if (e.countryOfOrigin && e.countryOfOrigin.trim() !== "") return e;
  for (const source of HARVEST_SOURCES) {
    const text = (e as unknown as Record<string, string | undefined>)[source.key];
    if (!text) continue;
    const match = ORIGIN_SPAN.exec(text);
    if (!match) continue;
    // Cut the span at a dash-separated next segment ("PRODUCT OF FRANCE - 750ML"), at a following
    // sentence ("PRODUCT OF FRANCE. CONTAINS SULFITES" — period-then-space, so "U.S.A." survives),
    // and at a responsibility tail ("BOTTLED IN FRANCE BY MAISON X"); then strip trailing
    // punctuation and require a NAMED country — the statutory test a region never passes. If a cut
    // breaks the country name, namedCountryIn fails and the harvest simply skips (conservative).
    const span = match[0]
      .split(/\s+[-]\s+/)[0]
      .split(/\.\s+/)[0]
      .split(/\s+by\s+/i)[0]
      .trim()
      .replace(/[.,;:\s]+$/, "");
    if (!namedCountryIn(span)) continue;
    // Inherit the source read's confidence; no confidence recorded means no basis to assert one.
    const sourceConfidence = e.confidence[source.confKey];
    if (sourceConfidence === undefined) continue;
    e.countryOfOrigin = span;
    e.confidence.countryOfOrigin = sourceConfidence;
    return e;
  }
  return e;
}
