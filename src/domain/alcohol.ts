/**
 * alcohol.ts — Pure alcohol-content helpers.
 *
 * CFR-VERIFIED MODULE (see ./README.md). Pure, side-effect-free arithmetic and the
 * statutory warning-exemption boundary. No I/O, no model calls — this is "code compares".
 */

/**
 * US proof <-> ABV relationship: proof = 2 x ABV. (Definitional in the US system; the
 * comparator uses these to cross-check a label that states both, e.g.
 * "45% Alc./Vol. (90 Proof)".)
 */
const PROOF_PER_ABV = 2 as const;

/**
 * The ABV threshold (in percentage points) at/above which the government health warning is
 * required, and below which a product is exempt.
 *
 * 27 CFR 16.10 defines an "alcoholic beverage" as a beverage in liquid form containing NOT
 * LESS THAN one-half of one percent (0.5%) alcohol by volume intended for human
 * consumption. Products below 0.5% ABV fall outside that definition and are therefore
 * EXEMPT from the Part 16 warning requirement. Matches AGENTS.md ("Required on beverages at
 * 0.5% ABV or above ... Products under 0.5% ABV are exempt"). Do NOT change this constant.
 */
export const WARNING_REQUIRED_ABV_THRESHOLD = 0.5 as const;

/**
 * Convert proof to ABV. proof = 2 x ABV, so ABV = proof / 2.
 * @param proof US proof degrees (e.g. 80).
 * @returns ABV in percentage points (e.g. 40).
 */
export function proofToAbv(proof: number): number {
  return proof / PROOF_PER_ABV;
}

/**
 * Convert ABV to proof. proof = 2 x ABV.
 * @param abv alcohol by volume in percentage points (e.g. 40).
 * @returns US proof degrees (e.g. 80).
 */
export function abvToProof(abv: number): number {
  return abv * PROOF_PER_ABV;
}

/**
 * Whether the government health warning is REQUIRED for a product at the given ABV.
 *
 * Encodes the 27 CFR 16.10 exemption: the warning is required at 0.5% ABV or ABOVE, and a
 * product UNDER 0.5% ABV is exempt (the comparator should treat the warning check as N/A,
 * not a violation, when this returns false).
 *
 *   isWarningRequired(0.4) === false  // exempt (below threshold)
 *   isWarningRequired(0.5) === true   // required (at threshold; "not less than 0.5%")
 *   isWarningRequired(0.6) === true   // required (above threshold)
 *
 * @param abv alcohol by volume in percentage points.
 * @returns true if the warning is required at this ABV; false if exempt.
 */
export function isWarningRequired(abv: number): boolean {
  return abv >= WARNING_REQUIRED_ABV_THRESHOLD;
}
