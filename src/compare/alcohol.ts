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
 * "13.5% ABV" into { abv, proof }.
 *
 * ABV is anchored to an alcohol CUE rather than "the first percentage", so a non-alcohol percentage
 * elsewhere on the label can't be mistaken for the alcohol content. This matters because real labels
 * routinely print other percentages — "100% Agave" on tequila, "100% Juice" on a flavored malt — and
 * a first-percentage parse would read 100% as the ABV and (claimed 100% vs labeled 100%) falsely
 * APPROVE a wildly wrong alcohol statement. Resolution order:
 *   1. "<n>% <cue>"     — "40% Alc./Vol.", "13.5% ABV"  (the canonical US form)
 *   2. "<cue> … <n>%"   — "ABV: 5.5%", "Alcohol 5.5% by volume"  (cue before the number)
 *   3. "<n> <cue>"      — "40 ABV"  (percent sign omitted)
 *   4. the first bare "<n>%"  — last resort, only when no alcohol cue is present at all
 * Both decimal separators are accepted ("13.5%" and the European "13,5%") so a comma decimal is not
 * truncated. A leading minus is captured (then rejected by the range guard below) so "-5%" can't be
 * silently read as 5.
 */
export function parseAlcoholText(text: string | undefined): ParsedAlcohol {
  if (!text) return {};
  const num = (s: string): number => Number(s.replace(",", "."));
  // Alcohol BY WEIGHT is a different unit (ABW x ~1.25 = ABV; a "4.0% alc/wt" beer is ~5.0% ABV), so
  // an ABW number must NEVER be read as the ABV — a silent unit mixup would skew the tolerance
  // verdict in either direction. ABW-only statement -> no abv (the field routes to review); when the
  // label states BOTH (the TTB-acceptable dual form), anchor strictly to the by-volume portion.
  const hasWeightCue = /\b(?:by\s+weight|abw)\b|alc[a-z.]*\s*[\s./-]*(?:by\s+)?wt\b/i.test(text);
  const abvMatch = hasWeightCue
    ? (text.match(/(-?\d+(?:[.,]\d+)?)\s*%\s*(?:alc(?:ohol)?[^%]{0,12}?vol|abv\b)/i) ??
      text.match(/(?:abv\b|alc(?:ohol)?[^%\d]{0,10}?vol[a-z.]*)[^\d%]{0,8}(-?\d+(?:[.,]\d+)?)\s*%/i))
    : (text.match(/(-?\d+(?:[.,]\d+)?)\s*%\s*(?:alc|abv|alcohol)/i) ??
      text.match(/(?:alc(?:ohol)?|abv)[^\d%]{0,8}(-?\d+(?:[.,]\d+)?)\s*%/i) ??
      text.match(/(-?\d+(?:[.,]\d+)?)\s*(?:abv|alc)/i) ??
      text.match(/(-?\d+(?:[.,]\d+)?)\s*%/));
  const proofMatch = text.match(/(-?\d+(?:[.,]\d+)?)\s*proof/i);
  // Discard physically-impossible values so a malformed number can't be treated as a real reading: an
  // ABV must be in [0, 100] (0 is allowed — non-alcoholic products legitimately read "0.0% Alc./Vol.",
  // and the <0.5% warning exemption needs a real 0); proof in [0, 200]. Out-of-range -> undefined,
  // which routes the field to "couldn't read"/review rather than a fabricated comparison.
  const abv = abvMatch ? num(abvMatch[1]) : undefined;
  const proof = proofMatch ? num(proofMatch[1]) : undefined;
  return {
    abv: abv !== undefined && abv >= 0 && abv <= 100 ? abv : undefined,
    proof: proof !== undefined && proof >= 0 && proof <= 200 ? proof : undefined,
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
