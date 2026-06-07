/**
 * compare/alcohol.ts — pure helpers for the alcohol-content check: parse the free-text alcohol
 * statement, and map a free-text beverage class to the domain `BeverageClass` enum that SELECTS
 * the tolerance rule. (The tolerance VALUES themselves live in src/domain — never hard-coded here.)
 */
import type { BeverageClass } from "@/domain";

/** Parsed alcohol statement. Both optional: proof is absent on labels that don't print it. */
export interface ParsedAlcohol {
  abv?: number;
  proof?: number;
}

/**
 * Parse a free-text alcohol statement like "45% Alc./Vol. (90 Proof)", "45% Alc./Vol." or
 * "13.5% ABV" into { abv, proof }. ABV = the first percentage; proof = a number before "proof".
 */
export function parseAlcoholText(text: string | undefined): ParsedAlcohol {
  if (!text) return {};
  const abvMatch =
    text.match(/(\d+(?:\.\d+)?)\s*%/) ?? text.match(/(\d+(?:\.\d+)?)\s*(?:abv|alc)/i);
  const proofMatch = text.match(/(\d+(?:\.\d+)?)\s*proof/i);
  return {
    abv: abvMatch ? Number(abvMatch[1]) : undefined,
    proof: proofMatch ? Number(proofMatch[1]) : undefined,
  };
}

/** Whether a class designation claims "low alcohol" / "reduced alcohol" (malt 2.5% cap, 27 CFR 7.65). */
export function isLowOrReducedAlcoholClaim(classText: string | undefined): boolean {
  if (!classText) return false;
  const t = classText.toLowerCase();
  return /\b(low|reduced)[\s-]?alcohol\b/.test(t);
}

/**
 * Map a free-text class/type (e.g. "distilled-spirits", "Table Wine", "India Pale Ale",
 * "Hard Cider") OR a domain enum value to the `BeverageClass` that selects the tolerance rule.
 * For wine, the ≤14% vs >14% split needs the ABV, so it is passed in when known.
 *
 * Returns "unknown" when nothing matches — the comparator then uses the tightest (conservative)
 * band, biasing toward review/fail over false approval.
 */
export function resolveBeverageClass(
  classText: string | undefined,
  abv?: number,
): BeverageClass {
  if (!classText) return "unknown";
  const t = classText.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Exact domain enum tokens (also catches "distilled-spirits" / "Distilled spirits").
  if (t === "distilledspirits") return "distilledSpirits";
  if (t === "wineunder14") return "wineUnder14";
  if (t === "wineover14") return "wineOver14";
  if (t === "maltbeverage") return "maltBeverage";
  if (t === "cider") return "cider";
  if (t === "unknown") return "unknown";

  // Keyword heuristics. Cider first (it has its own resolution), then malt, wine, spirits.
  if (t.includes("cider")) return "cider";
  if (/(malt|beer|ale|lager|stout|porter|ipa|pilsner)/.test(t)) return "maltBeverage";
  if (/(wine|port|sherry|vermouth|madeira|mead|sake|sangria)/.test(t)) {
    return abv !== undefined && abv > 14 ? "wineOver14" : "wineUnder14";
  }
  if (
    /(spirit|whiskey|whisky|bourbon|rye|vodka|gin|rum|tequila|mezcal|brandy|cognac|liqueur|distilled|scotch)/.test(
      t,
    )
  ) {
    return "distilledSpirits";
  }
  return "unknown";
}
