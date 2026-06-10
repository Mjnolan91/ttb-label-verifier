/**
 * tolerances.ts — Per-beverage-class ABV tolerance table, with CFR citations.
 *
 * CFR-VERIFIED MODULE (see ./README.md). The numbers here are statutory tolerances. Do
 * NOT change them to make a test pass.
 *
 * THE classType -> tolerance COUPLING (read this):
 *   The beverage class is an INPUT to the alcohol-content check, not a passive field. The
 *   class SELECTS the tolerance rule. The same labeled ABV is "in tolerance" or not
 *   depending entirely on the class — a +/-1.5 pp band for table wine vs. a +/-0.3 pp band
 *   for spirits. selectToleranceFor(beverageClass) performs that selection.
 *
 * IMPORTANT — the symmetric +/- value is NOT the whole rule. Several classes carry
 * asymmetric ABSOLUTE limits that the tolerance may NOT soften (e.g. the wine 14% tax-class
 * boundary in 4.36(c), the malt-beverage 0.5% floor and 2.5% low/reduced cap in 7.65).
 * Those boundary constraints are documented per-entry below and flagged for the comparator;
 * they are intentionally NOT collapsed into the single numeric tolerance, because doing so
 * would be wrong. The comparator is responsible for enforcing the boundary clamps.
 */

import type { BeverageClass } from "./types";

/**
 * A single tolerance rule. `value` is the symmetric +/- percentage-point tolerance applied
 * to the labeled ABV. `boundaryNote` records any absolute limit that the tolerance must not
 * be applied across (null when there is none), so the rule's asymmetric constraints travel
 * with it instead of being lost.
 */
export interface ToleranceRule {
  /** The beverage class this rule governs. */
  readonly beverageClass: BeverageClass;
  /**
   * Symmetric tolerance in percentage points applied above and below the labeled ABV.
   * Example: value 0.3 means a 40% label is acceptable at 39.7%–40.3% actual ABV.
   */
  readonly value: number;
  /** Short CFR citation for the tolerance value (full text in the per-entry comment). */
  readonly cfrCitation: string;
  /**
   * Absolute boundary constraint the tolerance may NOT be applied across, or null if none.
   * The comparator must respect this in addition to the +/- band; it is NOT folded into
   * `value`. (Documentation/enforcement aid, not arithmetic.)
   */
  readonly boundaryNote: string | null;
}

/**
 * The tolerance table, one entry per concrete (non-"unknown") beverage class.
 *
 * All values cross-checked against eCFR and the Cornell LII mirror (research confidence:
 * high for every entry below). Verbatim tolerance language is quoted in each comment.
 */
export const TOLERANCE_TABLE: { readonly [K in BeverageClass]: ToleranceRule } = {
  /**
   * DISTILLED SPIRITS — 27 CFR 5.65(c): "A tolerance of plus or minus 0.3 percentage
   * points is allowed for actual alcohol content that is above or below the labeled
   * alcohol content." Symmetric +/-0.3 pp, no conditions attached in the section text.
   * An alcohol-content statement is MANDATORY on all spirits regardless of ABV (5.65(a)).
   * (Section renumbered from the old 27 CFR 5.37 by the 2022 modernization — T.D. TTB-176,
   * 87 FR 7526, eff. Mar 11, 2022; the earlier 2020 Phase 1 rule was T.D. TTB-158.)
   */
  distilledSpirits: {
    beverageClass: "distilledSpirits",
    value: 0.3,
    cfrCitation: "27 CFR 5.65(c)",
    boundaryNote: null,
  },

  /**
   * WINE, 14% ABV OR LESS — 27 CFR 4.36(b)(1): "a tolerance of 1.5 percent, in the case of
   * wines containing 14 percent or less". Symmetric +/-1.5 pp for a single-point statement.
   *
   * HARD CONSTRAINT — 27 CFR 4.36(c): the tolerance may NOT be applied so as to move the
   * wine across the 14% tax-class boundary. So the effective upper edge of the band is
   * clamped at 14% (a wine actually over 14% may not ride the tolerance down to <=14%).
   * The comparator must clamp at 14%; this is recorded in boundaryNote, not in `value`.
   */
  wineUnder14: {
    beverageClass: "wineUnder14",
    value: 1.5,
    cfrCitation: "27 CFR 4.36(b)(1)",
    boundaryNote:
      "27 CFR 4.36(c): tolerance may not cross the 14% tax-class boundary; clamp the " +
      "effective band's upper edge at 14% ABV.",
  },

  /**
   * WINE, OVER 14% ABV — 27 CFR 4.36(b)(1): "a tolerance of 1 percent, in the case of wines
   * containing more than 14 percent". Symmetric +/-1.0 pp for a single-point statement.
   * Matches the AGENTS.md note ("wine over 14% ABV gets +/-1.0 percentage point").
   *
   * HARD CONSTRAINT — 27 CFR 4.36(c): the tolerance may NOT move the wine across the 14%
   * tax-class boundary, so the lower edge of the band is clamped to stay above 14% (a wine
   * actually over 14% may not ride the tolerance down to <=14%). A numeric alcohol-content
   * statement is MANDATORY for all wines over 14% ABV (4.36(a)).
   */
  wineOver14: {
    beverageClass: "wineOver14",
    value: 1.0,
    cfrCitation: "27 CFR 4.36(b)(1)",
    boundaryNote:
      "27 CFR 4.36(c): tolerance may not cross the 14% tax-class boundary; clamp the " +
      "effective band's lower edge to stay above 14% ABV.",
  },

  /**
   * MALT BEVERAGES / BEER — 27 CFR 7.65(c): "a tolerance of 0.3 percentage points will be
   * permitted, either above or below the stated alcohol content." Symmetric +/-0.3 pp.
   *
   * ABSOLUTE LIMITS the tolerance does NOT soften (comparator must respect): (1) hard 0.5%
   * floor — a malt beverage labeled >=0.5% ABV may not actually be <0.5% (7.65(c)); (2) "low
   * alcohol"/"reduced alcohol" only for products <2.5% ABV, and actual content may not
   * reach 2.5% regardless of tolerance (7.65(d)); (3) products under 0.5% ABV may be expressed
   * to 0.1/0.01 pp and are NOT subject to any tolerance. A numeric statement is OPTIONAL
   * federally (mandatory only when alcohol derives from added nonbeverage flavors/ingredients
   * other than hops extract, or where State law requires — 7.63(a)(3)/7.65(a)). (Renumbered
   * from old Part 7 by the 2022 modernization, T.D. TTB-176, 87 FR 7605, eff. Mar 11, 2022.)
   */
  maltBeverage: {
    beverageClass: "maltBeverage",
    value: 0.3,
    cfrCitation: "27 CFR 7.65(c)",
    boundaryNote:
      "Absolute limits not softened by the tolerance: 0.5% ABV floor for products labeled " +
      '>=0.5% (27 CFR 7.65(c)), and the 2.5% ABV cap on "low/reduced alcohol" (27 CFR 7.65(d)).',
  },

  /**
   * CIDER / HARD CIDER — has NO standalone ABV tolerance. Classification is by PRODUCTION
   * METHOD, not ABV: TTB treats typical apple/pear hard cider as WINE (a "fruit wine")
   * under 27 CFR Part 4, so 4.36 applies (+/-1.5 pp for the common <=14% case, with the
   * 4.36(c) boundary clamp). A cider BREWED from malted barley is instead a MALT BEVERAGE
   * under Part 7 (+/-0.3 pp, 7.65).
   *
   * RESOLUTION CHOICE: we resolve "cider" to the most common case — wine <=14%, +/-1.5 pp —
   * mirroring TOLERANCE_TABLE.wineUnder14. When a cider is known to be malt-based, callers
   * should classify it as `maltBeverage` upstream rather than `cider`. The 8.5% ABV figure
   * associated with cider is a TAX-RATE boundary (hard-cider rate eligibility), NOT a
   * labeling tolerance — do not encode it here.
   *
   * VERIFY before production: cider classification (wine vs. malt) is composition-driven;
   * confirm the upstream classifier picks the right Part per product. Source: TTB Cider FAQs
   * and TTB cider labeling guidance (research confidence: high on the rule, but the default
   * wine resolution is a simplification of a per-product determination).
   */
  cider: {
    beverageClass: "cider",
    value: 1.5,
    cfrCitation: "27 CFR 4.36(b)(1) (cider resolved as wine <=14%)",
    boundaryNote:
      "Cider resolves to wine (Part 4) by default; if brewed from malt it is a malt " +
      "beverage (27 CFR 7.65, +/-0.3 pp). 27 CFR 4.36(c) 14% boundary clamp applies in " +
      "the wine resolution. The 8.5% ABV hard-cider figure is a TAX boundary, not a " +
      "tolerance. VERIFY classification per product before production.",
  },

  /**
   * UNKNOWN — class not supplied/determinable. We pick the TIGHTEST tolerance among the
   * concrete classes (0.3 pp) as the conservative default, so an unknown class can never be
   * waved through on a wider band than it might actually warrant. This biases toward
   * `review`/`fail` over false approval, consistent with the asymmetric-thresholds
   * philosophy in AGENTS.md. This is a PRODUCT default, not a CFR tolerance.
   *
   * VERIFY before production: prefer routing unknown-class labels to human review rather
   * than auto-deciding on this default band.
   */
  unknown: {
    beverageClass: "unknown",
    value: 0.3,
    cfrCitation: "product default, not a CFR tolerance; tightest band used",
    boundaryNote:
      "No class supplied; uses the tightest tolerance (0.3 pp) to avoid false approvals. " +
      "Prefer human review for unknown-class labels.",
  },
} as const;

/**
 * Select the tolerance rule for a beverage class. This is the function that realizes the
 * classType -> tolerance coupling: the class is the INPUT, the tolerance rule is the OUTPUT.
 *
 * @param beverageClass the normalized class (an input that selects the rule).
 * @returns the ToleranceRule for that class. "cider" resolves to the wine (<=14%) rule by
 *          default; "unknown" resolves to the conservative tightest band. See the table
 *          comments for the full per-class CFR basis and boundary constraints.
 */
export function selectToleranceFor(beverageClass: BeverageClass): ToleranceRule {
  return TOLERANCE_TABLE[beverageClass];
}
