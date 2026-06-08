/**
 * compare/comparators.ts — the three deterministic TTB checks.
 *
 * Pure, side-effect-free, reproducible. Tolerance VALUES and the canonical warning come from
 * src/domain (the CFR-verified single source of truth); this module only applies the rules.
 *
 * Confidence is deliberately NOT consulted here — low-confidence routing to `review` is a
 * separate concern (the threshold gate) applied as a gate over these value-based verdicts.
 */
import {
  CANONICAL_GOVERNMENT_WARNING,
  isWarningRequired,
  selectToleranceFor,
  abvToProof,
  type BeverageClass,
} from "@/domain";
import type { FieldResult } from "./types";
import { normalizeText, normalizeWarning, similarity } from "./text";
import {
  parseAlcoholText,
  resolveBeverageClass,
  isLowOrReducedAlcoholClaim,
} from "./alcohol";

/** Float comparison slack so e.g. 40.3 - 40 (== 0.2999999996) lands inside a ±0.3 band. */
const EPS = 1e-6;

/**
 * Brand string-similarity threshold: at/above this (but not identical after normalization) the
 * brand is a close-but-not-exact match -> `review` (surface to a human) rather than a hard fail.
 * Below it -> `fail`. A one-character typo in a ~18-char brand is ~0.95 similar, well above this.
 */
const BRAND_REVIEW_SIMILARITY = 0.8;

/**
 * Producer/entity suffixes a label often appends to the brand mark, so the brand "ABC" and the
 * producer "ABC Distillery" are the same brand family. Stripped ONLY for the brand comparison so a
 * model that reads the producer instead of the mark resolves to a close match (review), never a hard
 * fail. Order-independent; applied repeatedly to catch multi-word suffixes like "brewing co".
 */
const BRAND_ENTITY_SUFFIX =
  /\s+(distilleries|distillery|distilling|distillers|distiller|wineries|winery|vineyards|vineyard|breweries|brewery|brewing|brewers|brewer|cellars|cellar|spirits|company|co|inc|llc|ltd|corporation|corp|estates|estate)$/;

function stripBrandEntitySuffixes(s: string): string {
  let out = s;
  while (BRAND_ENTITY_SUFFIX.test(out)) out = out.replace(BRAND_ENTITY_SUFFIX, "").trim();
  return out;
}

/** Whether `longer` contains `shorter` on WORD boundaries, e.g. "abc distillery" contains "abc". */
function wordBoundaryContains(longer: string, shorter: string): boolean {
  if (shorter === "") return false;
  return (
    longer === shorter ||
    longer.startsWith(`${shorter} `) ||
    longer.endsWith(` ${shorter}`) ||
    longer.includes(` ${shorter} `)
  );
}

/** Malt-beverage absolute limits the ±0.3 pp tolerance may NOT soften (27 CFR 7.65). */
const MALT_ABV_FLOOR = 0.5;
const MALT_LOW_ALCOHOL_CAP = 2.5;

/** 27 CFR 4.36(c): the wine tax-class boundary the tolerance may not be applied across. */
const WINE_TAX_CLASS_BOUNDARY = 14;

/** Human-readable class label for reasons. */
const CLASS_LABEL: Record<BeverageClass, string> = {
  distilledSpirits: "distilled-spirits",
  wineUnder14: "wine (≤14%)",
  wineOver14: "wine (>14%)",
  maltBeverage: "malt beverage",
  cider: "cider",
  unknown: "unknown-class",
};

function result(
  status: FieldResult["status"],
  claimed: string,
  extracted: string,
  reason: string,
): FieldResult {
  return { status, claimed, extracted, reason };
}

/**
 * Brand — fuzzy. Exact after normalization (case/space/punctuation/smart-quotes) = pass; a high
 * similarity but not identical = review; otherwise fail.
 */
export function compareBrand(args: {
  claimed?: string;
  extracted?: string;
}): FieldResult {
  const claimed = args.claimed ?? "";
  const extracted = args.extracted ?? "";
  const nc = normalizeText(claimed);
  const ne = normalizeText(extracted);

  if (ne.length === 0) {
    return result("fail", claimed, extracted || "(none)", "No brand name was read from the label.");
  }
  if (nc === ne) {
    return result(
      "pass",
      claimed,
      extracted,
      "Brand matches after normalizing case, spacing, punctuation and smart quotes.",
    );
  }
  // Brand mark vs producer name: "ABC" and "ABC Distillery" are the same brand family. Equal after
  // stripping a producer suffix, or one read containing the other, is a CLOSE MATCH -> review (not a
  // hard fail) — so the verdict is stable whether the model reads the mark or the producer. Review
  // (not pass) keeps a human in the loop, matching the minimize-false-approvals philosophy.
  const coreC = stripBrandEntitySuffixes(nc);
  const coreE = stripBrandEntitySuffixes(ne);
  if (coreC !== "" && coreC === coreE) {
    return result(
      "review",
      claimed,
      extracted,
      'Brand matches once a producer suffix (e.g. "Distillery") is set aside — confirm the brand mark vs. the producer name.',
    );
  }
  if (wordBoundaryContains(ne, nc) || wordBoundaryContains(nc, ne)) {
    return result(
      "review",
      claimed,
      extracted,
      "One brand name contains the other (e.g. a brand mark vs. the fuller printed name) — confirm they refer to the same brand.",
    );
  }
  const sim = similarity(nc, ne);
  if (sim >= BRAND_REVIEW_SIMILARITY) {
    return result(
      "review",
      claimed,
      extracted,
      `Brand is a close match (${Math.round(sim * 100)}% similar) but not identical — needs human review.`,
    );
  }
  return result("fail", claimed, extracted, "Brand does not match the claimed name.");
}

/**
 * Alcohol — numeric + class-selected tolerance. Parses both free-text statements, cross-checks
 * proof = 2 × ABV on the label, resolves the beverage class to its CFR tolerance rule, enforces
 * the documented hard limits, and fails when actual is outside the resolved band.
 */
export function compareAlcohol(args: {
  claimedText?: string;
  extractedText?: string;
  claimedClass?: string;
  /** The class/type read OFF THE LABEL. The "low/reduced alcohol" 2.5% cap (27 CFR 7.65(d)) is tied
   *  to the LABEL's own designation, so this must be consulted, not just the application's claim. */
  extractedClass?: string;
  beverageClass?: BeverageClass;
}): FieldResult {
  const claimedDisplay = args.claimedText ?? "(none)";
  const extractedDisplay = args.extractedText ?? "(none)";
  const claimed = parseAlcoholText(args.claimedText);
  const extracted = parseAlcoholText(args.extractedText);

  if (claimed.abv === undefined) {
    return result("review", claimedDisplay, extractedDisplay, "No claimed alcohol content to compare against.");
  }
  if (extracted.abv === undefined) {
    return result("review", claimedDisplay, extractedDisplay, "Could not read the alcohol content from the label.");
  }

  // Proof cross-check on the label itself (proof = 2 × ABV). An inconsistent label -> review.
  if (extracted.proof !== undefined && Math.abs(extracted.proof - abvToProof(extracted.abv)) > 0.1) {
    return result(
      "review",
      claimedDisplay,
      extractedDisplay,
      `Label is internally inconsistent: ${extracted.proof} proof ≠ 2 × ${extracted.abv}% ABV.`,
    );
  }

  const cls = args.beverageClass ?? resolveBeverageClass(args.claimedClass, claimed.abv);
  const rule = selectToleranceFor(cls);
  const tol = rule.value;
  const label = CLASS_LABEL[cls];

  // Hard absolute limits the tolerance may NOT cross (carried as boundaryNote in src/domain).
  if (cls === "wineUnder14" && extracted.abv > WINE_TAX_CLASS_BOUNDARY + EPS) {
    return result(
      "fail",
      claimedDisplay,
      extractedDisplay,
      `Actual ${extracted.abv}% crosses the 14% wine tax-class boundary; the ±${tol} pp tolerance may not be applied across it (27 CFR 4.36(c)).`,
    );
  }
  if (cls === "wineOver14" && extracted.abv <= WINE_TAX_CLASS_BOUNDARY + EPS) {
    return result(
      "fail",
      claimedDisplay,
      extractedDisplay,
      `Actual ${extracted.abv}% falls to/below the 14% wine tax-class boundary; the ±${tol} pp tolerance may not be applied across it (27 CFR 4.36(c)).`,
    );
  }
  if (cls === "maltBeverage" && claimed.abv >= MALT_ABV_FLOOR && extracted.abv < MALT_ABV_FLOOR - EPS) {
    return result(
      "fail",
      claimedDisplay,
      extractedDisplay,
      `A malt beverage labeled ≥0.5% may not actually be below the 0.5% ABV floor (27 CFR 7.65).`,
    );
  }
  if (
    cls === "maltBeverage" &&
    (isLowOrReducedAlcoholClaim(args.claimedClass) || isLowOrReducedAlcoholClaim(args.extractedClass)) &&
    extracted.abv >= MALT_LOW_ALCOHOL_CAP - EPS
  ) {
    return result(
      "fail",
      claimedDisplay,
      extractedDisplay,
      `"Low/reduced alcohol" malt beverages must be under 2.5% ABV (27 CFR 7.65).`,
    );
  }

  const delta = Math.abs(extracted.abv - claimed.abv);
  if (delta <= tol + EPS) {
    return result(
      "pass",
      claimedDisplay,
      extractedDisplay,
      `Actual ${extracted.abv}% is within the ±${tol} pp ${label} tolerance of the claimed ${claimed.abv}% (${rule.cfrCitation}).`,
    );
  }
  return result(
    "fail",
    claimedDisplay,
    extractedDisplay,
    `Actual ${extracted.abv}% is ${delta.toFixed(1)} pp from the claimed ${claimed.abv}%, outside the ±${tol} pp ${label} tolerance (${rule.cfrCitation}).`,
  );
}

/**
 * Government warning — strict. Body must match the canonical statutory wording; the prefix's
 * required ALL-CAPS (and BOLD where detectable) is read from the extracted flags, not re-derived
 * from raw text. Title-case, reworded, or missing = fail. Products under 0.5% ABV are exempt.
 */
export function compareWarning(args: {
  warningText?: string;
  warningPrefixIsAllCaps?: boolean;
  warningPrefixIsBold?: boolean | null;
  abv?: number;
}): FieldResult {
  const canonical = CANONICAL_GOVERNMENT_WARNING;
  const text = args.warningText ?? "";
  const allCaps = args.warningPrefixIsAllCaps ?? false;
  const bold = args.warningPrefixIsBold ?? null;

  // Exemption: products under 0.5% ABV are not required to carry the warning (27 CFR 16.10).
  if (args.abv !== undefined && !isWarningRequired(args.abv)) {
    return result(
      "pass",
      canonical,
      text || "(none)",
      "Warning not required: product is under the 0.5% ABV threshold (27 CFR 16.10).",
    );
  }
  if (normalizeWarning(text) === "") {
    return result("fail", canonical, "(missing)", "The government health warning is missing.");
  }
  if (normalizeWarning(text) !== normalizeWarning(canonical)) {
    return result(
      "fail",
      canonical,
      text,
      "Warning text does not match the canonical statutory wording (27 CFR 16.21).",
    );
  }
  if (!allCaps) {
    return result(
      "fail",
      canonical,
      text,
      'The "GOVERNMENT WARNING:" prefix must be in all capital letters (27 CFR 16.22(a)(2)).',
    );
  }
  if (bold === false) {
    return result(
      "fail",
      canonical,
      text,
      'The "GOVERNMENT WARNING:" prefix must be bold (27 CFR 16.22(a)(2)).',
    );
  }
  return result(
    "pass",
    canonical,
    text,
    "Warning matches the canonical statutory text with a correctly formatted prefix.",
  );
}
