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
import { canonicalCountry, displayCountry, foreignCountryFromAddress, namedCountryIn } from "./origin";

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

  // An APPLICATION entry carrying only proof still states the alcohol content: proof is twice the
  // ABV by definition (27 CFR 5.65), so an agent typing "80 proof" compares as 40%. CLAIMED side
  // only, deliberately: deriving on the LABEL side would let a %-less, proof-only label (itself a
  // 5.65 defect) sail through comparison while completeness reads the statement as present — the
  // completeness check flags proof-only labels as malformed instead (see completeness.ts).
  const claimedDerived = claimed.abv === undefined && claimed.proof !== undefined;
  if (claimedDerived) claimed.abv = claimed.proof! / 2;
  const derivedNote = claimedDerived
    ? " ABV was derived from the stated proof (proof is twice the ABV, 27 CFR 5.65)."
    : "";

  if (claimed.abv === undefined) {
    // Distinguish a BLANK entry from a typed-but-unparseable one: "40" or "4O%" is not nothing,
    // and telling the agent nothing was claimed sends them hunting the wrong problem.
    const typed = (args.claimedText ?? "").trim();
    return result(
      "review",
      claimedDisplay,
      extractedDisplay,
      typed === ""
        ? "No claimed alcohol content to compare against."
        : `Couldn't parse the application's alcohol entry ("${typed}"). Use a percent form like "40% Alc./Vol.".`,
    );
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
      `Actual ${extracted.abv}% crosses the 14% wine tax-class boundary; the ±${tol} percentage-point tolerance may not be applied across it (27 CFR 4.36(c)).`,
    );
  }
  if (cls === "wineOver14" && extracted.abv <= WINE_TAX_CLASS_BOUNDARY + EPS) {
    return result(
      "fail",
      claimedDisplay,
      extractedDisplay,
      `Actual ${extracted.abv}% falls to/below the 14% wine tax-class boundary; the ±${tol} percentage-point tolerance may not be applied across it (27 CFR 4.36(c)).`,
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
      `Actual ${extracted.abv}% is within the ±${tol} percentage-point ${label} tolerance of the claimed ${claimed.abv}% (${rule.cfrCitation}).${derivedNote}`,
    );
  }
  return result(
    "fail",
    claimedDisplay,
    extractedDisplay,
    `Actual ${extracted.abv}% is ${delta.toFixed(1)} percentage points from the claimed ${claimed.abv}%, outside the ±${tol} percentage-point ${label} tolerance (${rule.cfrCitation}).${derivedNote}`,
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
    // Both customary: compare the converted fluid-ounce quantities, so "1 PINT" equals "16 FL OZ"
    // instead of failing on dissimilar text.
    if (c.flOz !== undefined && e.flOz !== undefined) {
      return Math.abs(c.flOz - e.flOz) <= 0.05
        ? result("pass", claimed, extracted, `Net contents match (${e.flOz} fl oz).`)
        : result("fail", claimed, extracted, `Net contents differ: application states ${c.flOz} fl oz, label states ${e.flOz} fl oz.`);
    }
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
  // The two lawful spellings of the same designation ("whiskey"/"whisky", 27 CFR 5.143 note) are
  // one word for comparison purposes; the fold also lets "Whisky" contain-match "Bourbon Whiskey".
  const fc = nc.replace(/\bwhiskey\b/g, "whisky");
  const fe = ne.replace(/\bwhiskey\b/g, "whisky");
  if (fc === fe) {
    return result("pass", claimed, extracted, "Class/type matches after normalizing (whisky spelling).");
  }
  const claimedClass = args.claimedBeverageClass ?? resolveBeverageClass(claimed);
  const extractedClass = resolveBeverageClass(extracted);
  const isWine = (b: BeverageClass) => b === "wineUnder14" || b === "wineOver14";
  const sameFamily =
    claimedClass !== "unknown" &&
    (claimedClass === extractedClass || (isWine(claimedClass) && isWine(extractedClass)));
  // The resolved-class PASS exists for a BROAD application term covering a specific label
  // designation: a generic category ("distilled spirits" vs "Kentucky Straight Bourbon Whiskey"),
  // or the claimed term appearing AS the head of the label's fuller designation ("Rum" vs
  // "Superior Caribbean Rum" — the AI over-capturing an adjective must not break the verdict).
  // It must NOT fire for two DISJOINT designations that merely share a family: "Vodka" vs "Gin"
  // both resolve to distilled-spirits, and that is a real discrepancy, not a match.
  if (sameFamily && (GENERIC_CLASS_CLAIM.test(nc) || wordBoundaryContains(fe, fc))) {
    return result("pass", claimed, extracted,
      `Both resolve to ${CLASS_LABEL[extractedClass]}, so the label's specific designation matches the application's class.`);
  }
  if (wordBoundaryContains(fe, fc) || wordBoundaryContains(fc, fe)) {
    return result("review", claimed, extracted, "One class/type designation contains the other. Confirm they're the same.");
  }
  if (similarity(fc, fe) >= CLASS_REVIEW_SIMILARITY) {
    return result("review", claimed, extracted, `Class/type is a close match (${Math.round(similarity(fc, fe) * 100)}%). Confirm.`);
  }
  if (sameFamily) {
    return result("review", claimed, extracted,
      `Both are ${CLASS_LABEL[extractedClass]}, but the designations differ. Confirm the label matches what was filed.`);
  }
  if (claimedClass !== "unknown" && extractedClass !== "unknown") {
    return result("fail", claimed, extracted,
      `Class/type differs: the application is ${CLASS_LABEL[claimedClass]}, the label is ${CLASS_LABEL[extractedClass]}.`);
  }
  return result("review", claimed, extracted, "Class/type couldn't be confidently matched. A person should confirm.");
}

/** Application class terms BROAD enough that any same-family label designation satisfies them.
 *  Deliberately excludes specific designations (vodka, gin, stout, red wine): those must match
 *  the label's designation, not merely its family. */
const GENERIC_CLASS_CLAIM =
  /^(?:distilled spirits?|spirits?|wine|table wine|malt beverages?|beer|cider|hard cider)$/;

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
export function compareOrigin(args: { claimed?: string; extracted?: string; extractedAddress?: string }): FieldResult {
  const claimed = args.claimed ?? "";
  const extracted = args.extracted ?? "";
  // Strip the marking lead-in AND a leading article: "USA" must equal "MADE IN THE USA".
  const strip = (s: string) => normalizeText(s.replace(ORIGIN_PREFIX, "")).replace(/^the\s+/, "");
  const nc = strip(claimed);
  const ne = strip(extracted);
  if (ne.length === 0) {
    return result("review", claimed || "(none)", extracted || "(none)", "No country of origin was read from the label to compare.");
  }

  // Matching the application is not the whole check: the marking must name a COUNTRY. A region
  // ("Imported from the Caribbean") can match the application verbatim and still be unlawful
  // under the CBP rules the TTB origin sections incorporate. Review, never auto-fail: the
  // country recognizer is conservative and a person decides.
  const labelNamesNoCountry = !namedCountryIn(extracted);
  const regionReview = (lead: string) => {
    const from = foreignCountryFromAddress(args.extractedAddress);
    const hint = from ? ` The producer address suggests "Product of ${displayCountry(from)}".` : "";
    // Georgia is both a country and a US state; the recognizer deliberately can't tell. Say so
    // instead of flatly calling a real wine-exporting country "not a country".
    const georgia = /\bgeorgia\b/i.test(extracted)
      ? " Note: Georgia is both a country and a US state; confirm which is intended."
      : "";
    return result(
      "review",
      claimed,
      extracted,
      `${lead} "${extracted}" does not name a recognized country. ` +
        `CBP marking requires the country of origin (19 CFR 134; 27 CFR 5.69 / 7.69 / 4.35(e)).${hint}${georgia}`,
    );
  };

  if (nc === ne) {
    if (labelNamesNoCountry) return regionReview("The label matches the application, but");
    return result("pass", claimed, extracted, "Country of origin matches.");
  }

  // Same COUNTRY under different lawful names: "UK" vs "United Kingdom", "Scotland" vs "United
  // Kingdom", "Holland" vs "Netherlands", "Spain" vs "Product of España". Text differs, origin
  // does not — a hard fail here was pure false alarm.
  const claimedCountry = canonicalCountry(claimed);
  const extractedCountry = canonicalCountry(extracted);
  if (claimedCountry !== null && claimedCountry === extractedCountry) {
    return result(
      "pass",
      claimed,
      extracted,
      `Country of origin matches: both name ${displayCountry(claimedCountry)}.`,
    );
  }

  if (wordBoundaryContains(ne, nc) || wordBoundaryContains(nc, ne) || similarity(nc, ne) >= ORIGIN_REVIEW_SIMILARITY) {
    if (labelNamesNoCountry) return regionReview("The label is close to the application, but");
    return result("review", claimed, extracted, "Country of origin is close but not identical. Confirm.");
  }
  // Two recognized but DIFFERENT countries is a genuine defect; an unrecognized side is more
  // likely a typo ("Mexcio") or a region, so a person decides instead of an auto-reject.
  if (claimedCountry !== null && extractedCountry !== null) {
    return result("fail", claimed, extracted, "Country of origin does not match the application.");
  }
  if (extractedCountry !== null) {
    return result(
      "review",
      claimed,
      extracted,
      `The application's country was not recognized (a typo is likely); the label names ${displayCountry(extractedCountry)}. Confirm.`,
    );
  }
  if (labelNamesNoCountry) return regionReview("The label differs from the application, and");
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
  warningRemainderIsBold?: boolean | null;
  warningIsReadilyLegible?: boolean | null;
  abv?: number;
}): FieldResult {
  const canonical = CANONICAL_GOVERNMENT_WARNING;
  const text = args.warningText ?? "";
  const allCaps = args.warningPrefixIsAllCaps ?? null;
  const bold = args.warningPrefixIsBold ?? null;
  // Supplementary 16.22 signals. Deliberately ASYMMETRIC to the prefix flags above: only a
  // confident violation acts; null is silent (the prefix format is the load-bearing check that
  // demands positive verification, and routing every label to review whenever a secondary signal
  // is unreadable would drown the reviewer).
  const remainderBold = args.warningRemainderIsBold ?? null;
  const legible = args.warningIsReadilyLegible ?? null;

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
  if (remainderBold === true) {
    return result(
      "fail",
      canonical,
      text,
      'Only the "GOVERNMENT WARNING:" prefix may be bold. The remainder of the warning statement ' +
        "may not appear in bold type (27 CFR 16.22(a)(2)).",
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
  // Legibility (27 CFR 16.22(a)(1), "readily legible under ordinary conditions") is a typography
  // JUDGMENT, not a deterministic comparison — so a confident "hard to read" routes to a human and
  // is never auto-failed. Italic/serif style alone is NOT a violation (the regulation never
  // mentions italics); only genuinely-hard-to-read treatment lands here.
  if (legible === false) {
    return result(
      "review",
      canonical,
      text,
      "The warning statement must be readily legible under ordinary conditions (27 CFR 16.22(a)(1)). " +
        "The type treatment looks hard to read. Confirm on the label.",
    );
  }
  // VERIFIED means verified. The text matches and nothing is confidently wrong, but if a prefix
  // format flag could not be read from the image (null), a pass here would claim a verification
  // that never happened — and the warning is the one check where that silence is indistinguishable
  // from a real check. Route to review naming exactly what a human still needs to confirm.
  const unverified = [
    ...(allCaps === null ? ["all capital letters"] : []),
    ...(bold === null ? ["bold type"] : []),
  ];
  if (unverified.length > 0) {
    return result(
      "review",
      canonical,
      text,
      `Warning text matches the statutory wording, but the "GOVERNMENT WARNING:" prefix could not be ` +
        `verified as ${unverified.join(" and ")} from the image (27 CFR 16.22(a)(2)). Confirm on the label.`,
    );
  }
  return result(
    "pass",
    canonical,
    text,
    "Warning matches the canonical statutory text with a correctly formatted prefix.",
  );
}
