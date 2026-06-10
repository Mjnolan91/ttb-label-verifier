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
  parseNetContents,
  isAuthorizedFill,
  type BeverageClass,
} from "@/domain";
import type { FieldResult } from "./types";
import { normalizeText, normalizeWarning, normalizeBrandKeepingSymbols, similarity } from "./text";
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
    // Equal after dropping ALL punctuation. If they also match with symbols kept, it's a true match;
    // if they differ ONLY in punctuation/symbols ("Smith & Co" vs "Smith Co"), that can be a distinct
    // registered brand — route to review rather than auto-approve (27 CFR 5.64/4.33 brand identity).
    if (normalizeBrandKeepingSymbols(claimed) === normalizeBrandKeepingSymbols(extracted)) {
      return result(
        "pass",
        claimed,
        extracted,
        "Brand matches after normalizing case, spacing and smart quotes.",
      );
    }
    return result(
      "review",
      claimed,
      extracted,
      'Brand matches except for punctuation/symbols (e.g. "&", "-"). Confirm they are the same brand.',
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
      'Brand matches once a producer suffix (e.g. "Distillery") is set aside. Confirm the brand mark vs. the producer name.',
    );
  }
  if (wordBoundaryContains(ne, nc) || wordBoundaryContains(nc, ne)) {
    return result(
      "review",
      claimed,
      extracted,
      "One brand name contains the other (e.g. a brand mark vs. the fuller printed name). Confirm they refer to the same brand.",
    );
  }
  const sim = similarity(nc, ne);
  if (sim >= BRAND_REVIEW_SIMILARITY) {
    return result(
      "review",
      claimed,
      extracted,
      `Brand is a close match (${Math.round(sim * 100)}% similar) but not identical. Needs human review.`,
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
  // `cider` resolves to the wine (≤14%) tolerance by default, so the 4.36(c) clamp its own
  // boundaryNote promises applies to it too — without this it would ride its ±1.5 pp band across 14%.
  if ((cls === "wineUnder14" || cls === "cider") && extracted.abv > WINE_TAX_CLASS_BOUNDARY + EPS) {
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
 * Label-INTERNAL alcohol validity — defects visible on the label's own face, with NO application
 * value needed. Reused by completeness.ts (the no-application headline) and confirm.ts so they
 * enforce the same internal checks compareAlcohol already applies when a claimed value IS present
 * (previously these only ran on the claimed-comparison path):
 *   - US proof must equal 2 × ABV (definitional);
 *   - a "low/reduced alcohol" malt beverage must be under 2.5% ABV (27 CFR 7.65(d)).
 * Returns a human-readable reason when the label is internally invalid, else null.
 */
export function checkAlcoholInternalConsistency(
  alcoholText: string | undefined,
  classText: string | undefined,
  cls: BeverageClass,
): string | null {
  const { abv, proof } = parseAlcoholText(alcoholText);
  if (abv === undefined) return null; // nothing numeric to validate; presence is handled elsewhere
  if (proof !== undefined && Math.abs(proof - abvToProof(abv)) > 0.1) {
    return `Label is internally inconsistent: ${proof} proof ≠ 2 × ${abv}% ABV (proof = 2 × ABV).`;
  }
  if (cls === "maltBeverage" && isLowOrReducedAlcoholClaim(classText) && abv >= MALT_LOW_ALCOHOL_CAP - EPS) {
    return `"Low/reduced alcohol" malt beverages must be under 2.5% ABV (27 CFR 7.65(d)).`;
  }
  return null;
}

/**
 * Net contents — class-specific. Validates the stated quantity (not just presence):
 *   - the unit SYSTEM is mandated per class — metric for distilled spirits (27 CFR 5.71) and wine
 *     (27 CFR 4.73); US-customary for malt beverages (27 CFR 7.70);
 *   - the SIZE must be an authorized standard of fill for distilled spirits (27 CFR 5.203) and wine
 *     (27 CFR 4.72); malt beverages have NO standard of fill (any size is lawful).
 * Returns a human-readable reason when the stated net contents is non-compliant on its face, else
 * null. A non-listed metric SIZE is surfaced (review) rather than asserted impossible — TTB adds sizes.
 */
export function validateNetContents(value: string | undefined, cls: BeverageClass): string | null {
  const nc = parseNetContents(value);
  if (!nc.parsed) {
    return "Net contents is not a recognizable quantity with a unit (e.g. \"750 mL\" or \"12 FL OZ\").";
  }
  if (cls === "maltBeverage") {
    // No standard of fill for malt; only the US-customary statement is required (27 CFR 7.70).
    if (!nc.hasUsCustomary) {
      return "Malt beverages must state net contents in US-customary units, e.g. fluid ounces (27 CFR 7.70).";
    }
    return null;
  }
  if (cls === "distilledSpirits" || cls === "wineUnder14" || cls === "wineOver14" || cls === "cider") {
    const kind = cls === "distilledSpirits" ? "spirits" : "wine";
    const metricCite = kind === "spirits" ? "27 CFR 5.71" : "27 CFR 4.73";
    const fillCite = kind === "spirits" ? "27 CFR 5.203" : "27 CFR 4.72";
    if (nc.ml === undefined) {
      return `${kind === "spirits" ? "Distilled spirits" : "Wine"} must state net contents in metric (mL or L) (${metricCite}).`;
    }
    if (!isAuthorizedFill(nc.ml, kind)) {
      return `${nc.ml} mL is not an authorized standard of fill for ${kind === "spirits" ? "distilled spirits" : "wine"} (${fillCite}). Confirm the container size.`;
    }
    return null;
  }
  return null; // unknown class — don't assert a rule we can't determine
}

/** Class/type similarity threshold: a close-but-not-identical designation routes to review. */
const CLASS_REVIEW_SIMILARITY = 0.8;
/** Producer-name similarity threshold for a review-leaning fuzzy match. */
const NAME_REVIEW_SIMILARITY = 0.8;
/** Address similarity threshold (addresses abbreviate heavily: "St"/"Street", "KY"/"Kentucky"). */
const ADDRESS_REVIEW_SIMILARITY = 0.6;
/** Country-of-origin similarity threshold. */
const ORIGIN_REVIEW_SIMILARITY = 0.8;
/** "Product of …" / "Made in …" lead-ins stripped before comparing the country itself. */
const ORIGIN_PREFIX = /^(?:product of|produce of|made in|bottled in|imported from)\s+/i;

/**
 * Net contents — CLAIMED vs label (distinct from validateNetContents, which checks the label's net
 * contents against CFR standards of fill). Metric magnitudes are compared numerically; US-customary
 * statements (no parsed magnitude) fall back to normalized text; mixed unit systems route to review
 * (750 mL vs 25.4 fl oz may be equal — a human call). Compared only when the application supplies one.
 */
export function compareNetContents(args: { claimed?: string; extracted?: string }): FieldResult {
  const claimed = args.claimed ?? "";
  const extracted = args.extracted ?? "";
  const c = parseNetContents(claimed);
  const e = parseNetContents(extracted);
  if (!e.parsed) {
    return result("review", claimed || "(none)", extracted || "(none)",
      "Couldn't read a net-contents quantity from the label to compare against the application.");
  }
  if (!c.parsed) {
    return result("review", claimed || "(none)", extracted, "Couldn't parse the application's net contents to compare.");
  }
  if (c.ml !== undefined && e.ml !== undefined) {
    return Math.abs(c.ml - e.ml) <= 0.5
      ? result("pass", claimed, extracted, `Net contents match (${e.ml} mL).`)
      : result("fail", claimed, extracted, `Net contents differ: application states ${c.ml} mL, label states ${e.ml} mL.`);
  }
  if (c.ml === undefined && e.ml === undefined) {
    const nc = normalizeText(claimed);
    const ne = normalizeText(extracted);
    if (nc === ne) return result("pass", claimed, extracted, "Net contents match after normalizing.");
    if (similarity(nc, ne) >= 0.8) return result("review", claimed, extracted, "Net contents are close but not identical. Confirm.");
    return result("fail", claimed, extracted, "Net contents do not match the application.");
  }
  return result("review", claimed, extracted,
    "Application and label state net contents in different unit systems. Confirm they're equal.");
}

/**
 * Class/type — the application often lists a broad class ("distilled spirits") while the label prints
 * the specific standard of identity ("Kentucky Straight Bourbon Whiskey"). Both resolving to the SAME
 * BeverageClass is a genuine match (pass); only DIFFERENT resolved classes are a hard fail. Anything
 * uncertain (containment, close text, an unknown class) routes to review.
 */
export function compareClassType(args: {
  claimed?: string;
  extracted?: string;
  claimedBeverageClass?: BeverageClass;
}): FieldResult {
  const claimed = args.claimed ?? "";
  const extracted = args.extracted ?? "";
  const nc = normalizeText(claimed);
  const ne = normalizeText(extracted);
  if (ne.length === 0) {
    return result("review", claimed || "(none)", extracted || "(none)", "No class/type designation was read from the label to compare.");
  }
  if (nc === ne) {
    return result("pass", claimed, extracted, "Class/type matches after normalizing.");
  }
  const claimedClass = args.claimedBeverageClass ?? resolveBeverageClass(claimed);
  const extractedClass = resolveBeverageClass(extracted);
  const isWine = (b: BeverageClass) => b === "wineUnder14" || b === "wineOver14";
  if (claimedClass !== "unknown" && (claimedClass === extractedClass || (isWine(claimedClass) && isWine(extractedClass)))) {
    return result("pass", claimed, extracted,
      `Both resolve to ${CLASS_LABEL[extractedClass]}, so the label's specific designation matches the application's class.`);
  }
  if (wordBoundaryContains(ne, nc) || wordBoundaryContains(nc, ne)) {
    return result("review", claimed, extracted, "One class/type designation contains the other. Confirm they're the same.");
  }
  if (similarity(nc, ne) >= CLASS_REVIEW_SIMILARITY) {
    return result("review", claimed, extracted, `Class/type is a close match (${Math.round(similarity(nc, ne) * 100)}%). Confirm.`);
  }
  if (claimedClass !== "unknown" && extractedClass !== "unknown") {
    return result("fail", claimed, extracted,
      `Class/type differs: the application is ${CLASS_LABEL[claimedClass]}, the label is ${CLASS_LABEL[extractedClass]}.`);
  }
  return result("review", claimed, extracted, "Class/type couldn't be confidently matched. A person should confirm.");
}

/**
 * Producer/bottler name — fuzzy and review-leaning (NEVER a hard fail): a mismatch is commonly a
 * benign importer-vs-producer or company-suffix difference, a human call. Reuses the brand
 * entity-suffix / containment / similarity ladder.
 */
export function compareName(args: { claimed?: string; extracted?: string }): FieldResult {
  const claimed = args.claimed ?? "";
  const extracted = args.extracted ?? "";
  const nc = normalizeText(claimed);
  const ne = normalizeText(extracted);
  if (ne.length === 0) {
    return result("review", claimed || "(none)", extracted || "(none)", "No producer/bottler name was read from the label to compare.");
  }
  if (nc === ne) {
    return result("pass", claimed, extracted, "Producer name matches after normalizing.");
  }
  const coreC = stripBrandEntitySuffixes(nc);
  const coreE = stripBrandEntitySuffixes(ne);
  if (coreC !== "" && coreC === coreE) {
    return result("review", claimed, extracted, 'Producer name matches once a company suffix (e.g. "Co", "LLC") is set aside. Confirm.');
  }
  if (wordBoundaryContains(ne, nc) || wordBoundaryContains(nc, ne) || similarity(nc, ne) >= NAME_REVIEW_SIMILARITY) {
    return result("review", claimed, extracted, "Producer name is close but not identical. Confirm it's the same entity.");
  }
  return result("review", claimed, extracted, "Producer name differs from the application. A person should confirm (e.g. importer vs. producer).");
}

/**
 * Producer/bottler address — fuzzy and review-leaning (NEVER a hard fail): addresses abbreviate
 * heavily (St/Street, KY/Kentucky) and a difference is a human call, not an auto-reject.
 */
export function compareAddress(args: { claimed?: string; extracted?: string }): FieldResult {
  const claimed = args.claimed ?? "";
  const extracted = args.extracted ?? "";
  const nc = normalizeText(claimed);
  const ne = normalizeText(extracted);
  if (ne.length === 0) {
    return result("review", claimed || "(none)", extracted || "(none)", "No address was read from the label to compare.");
  }
  if (nc === ne) {
    return result("pass", claimed, extracted, "Address matches after normalizing.");
  }
  if (wordBoundaryContains(ne, nc) || wordBoundaryContains(nc, ne) || similarity(nc, ne) >= ADDRESS_REVIEW_SIMILARITY) {
    return result("review", claimed, extracted, "Address is close but not identical. Confirm.");
  }
  return result("review", claimed, extracted, "Address differs from the application. A person should confirm.");
}

/**
 * Country of origin — normalized text, import-only (compared only when the application provides it).
 * A genuinely different country is a real defect, so this CAN fail; close/contained -> review.
 */
export function compareOrigin(args: { claimed?: string; extracted?: string }): FieldResult {
  const claimed = args.claimed ?? "";
  const extracted = args.extracted ?? "";
  const nc = normalizeText(claimed.replace(ORIGIN_PREFIX, ""));
  const ne = normalizeText(extracted.replace(ORIGIN_PREFIX, ""));
  if (ne.length === 0) {
    return result("review", claimed || "(none)", extracted || "(none)", "No country of origin was read from the label to compare.");
  }
  if (nc === ne) {
    return result("pass", claimed, extracted, "Country of origin matches.");
  }
  if (wordBoundaryContains(ne, nc) || wordBoundaryContains(nc, ne) || similarity(nc, ne) >= ORIGIN_REVIEW_SIMILARITY) {
    return result("review", claimed, extracted, "Country of origin is close but not identical. Confirm.");
  }
  return result("fail", claimed, extracted, "Country of origin does not match the application.");
}

/**
 * Distinctive / fanciful ("sell") name — fuzzy, review-leaning (NEVER a hard fail): a difference
 * between the application's and the label's fanciful name is a human call, not an auto-reject.
 */
export function compareFancifulName(args: { claimed?: string; extracted?: string }): FieldResult {
  const claimed = args.claimed ?? "";
  const extracted = args.extracted ?? "";
  const nc = normalizeText(claimed);
  const ne = normalizeText(extracted);
  if (ne.length === 0) {
    return result("review", claimed || "(none)", extracted || "(none)", "No distinctive/fanciful name was read from the label to compare.");
  }
  if (nc === ne) {
    return result("pass", claimed, extracted, "Fanciful name matches after normalizing.");
  }
  if (wordBoundaryContains(ne, nc) || wordBoundaryContains(nc, ne) || similarity(nc, ne) >= NAME_REVIEW_SIMILARITY) {
    return result("review", claimed, extracted, "Fanciful name is close but not identical. Confirm.");
  }
  return result("review", claimed, extracted, "Fanciful name differs from the application. A person should confirm.");
}

/**
 * Statement of composition — fuzzy, review-leaning. For a specialty this completes the class/type
 * designation, so a difference is surfaced for a person rather than auto-rejected.
 */
export function compareStatementOfComposition(args: { claimed?: string; extracted?: string }): FieldResult {
  const claimed = args.claimed ?? "";
  const extracted = args.extracted ?? "";
  const nc = normalizeText(claimed);
  const ne = normalizeText(extracted);
  if (ne.length === 0) {
    return result("review", claimed || "(none)", extracted || "(none)", "No statement of composition was read from the label to compare.");
  }
  if (nc === ne) {
    return result("pass", claimed, extracted, "Statement of composition matches after normalizing.");
  }
  if (wordBoundaryContains(ne, nc) || wordBoundaryContains(nc, ne) || similarity(nc, ne) >= NAME_REVIEW_SIMILARITY) {
    return result("review", claimed, extracted, "Statement of composition is close but not identical. Confirm.");
  }
  return result("review", claimed, extracted, "Statement of composition differs from the application. A person should confirm.");
}

/**
 * Government warning — strict. Body must match the canonical statutory wording; the prefix's
 * required ALL-CAPS (and BOLD where detectable) is read from the extracted flags, not re-derived
 * from raw text. Title-case, reworded, or missing = fail. Products under 0.5% ABV are exempt.
 */
export function compareWarning(args: {
  warningText?: string;
  warningPrefixIsAllCaps?: boolean | null;
  warningPrefixIsBold?: boolean | null;
  abv?: number;
}): FieldResult {
  const canonical = CANONICAL_GOVERNMENT_WARNING;
  const text = args.warningText ?? "";
  const allCaps = args.warningPrefixIsAllCaps ?? null;
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
  if (allCaps === false) {
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
  // The statutory text capitalizes "Surgeon General" (the TTB checklists call the S and G out
  // explicitly), but the wording comparison above case-folds — so check the RAW text's casing here.
  // An all-caps rendering ("SURGEON GENERAL") still satisfies the rule. Review, not fail: this case
  // comes from raw OCR text where a mid-sentence case misread is plausible, so a human confirms and
  // the label is never auto-approved on it.
  const sg = text.match(/\b(s)urgeon\s+(g)eneral\b/i);
  if (sg && (sg[1] !== "S" || sg[2] !== "G")) {
    return result(
      "review",
      canonical,
      text,
      '"Surgeon General" must be capitalized (the S and G) in the warning text. Confirm against the label.',
    );
  }
  return result(
    "pass",
    canonical,
    text,
    "Warning matches the canonical statutory text with a correctly formatted prefix.",
  );
}
