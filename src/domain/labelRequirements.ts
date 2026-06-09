/**
 * labelRequirements.ts — which label elements TTB requires, per beverage class.
 *
 * CFR-VERIFIED MODULE (extends the domain; see ./README.md). Sourced from TTB's mandatory-label-info
 * checklists for distilled spirits (27 CFR Part 5), wine (Part 4), and malt beverages (Part 7), plus
 * the health-warning rule (Part 16). The completeness check (src/compare/completeness.ts) reads this
 * matrix to flag each mandatory element as present / missing / malformed.
 *
 * `alcoholContent` necessity is per-class, because the CFR genuinely differs (the completeness
 * check, completeness.ts, honors these):
 *  - distilled spirits — MANDATORY at any ABV (27 CFR 5.65).
 *  - wine > 14% ABV — MANDATORY (27 CFR 4.36(a)).
 *  - wine <= 14% ABV — CONDITIONAL: a numeric statement OR a "table wine"/"light wine" designation
 *    (27 CFR 4.36(a)); a <=14% wine with neither is incomplete.
 *  - malt beverages — CONDITIONAL: optional unless alcohol derives from added nonbeverage
 *    flavors/ingredients other than hops extract, or State law requires (27 CFR 7.63(a)(3), 7.65(a)).
 *
 * Documented simplifications (like tolerances.ts — do not silently "fix" these):
 *  - `sulfiteDeclaration` is modeled CONDITIONAL for wine, matching the CFR: "Contains Sulfites" is
 *    required only at >= 10 ppm SO2 (27 CFR 4.32(e)), and the ppm cannot be read from a label image.
 *    So an absent declaration is surfaced as `unverifiable` (review), never a hard "missing" — we do
 *    not fail a genuinely sulfite-free wine. (The same conditional rule applies to spirits/malt under
 *    5.63(c)(7) / 7.63(b)(3); those classes don't list it because the extractor can't confirm the ppm.)
 *  - Conditional additive disclosures (FD&C Yellow No. 5, cochineal/carmine, aspartame "PHENYLKETONURICS"
 *    per 4.32/5.63/7.63) are NOT modeled — they are present-only and the extractor does not read them.
 *    (Saccharin disclosure was REPEALED in 2004 and is deliberately absent.)
 *  - `countryOfOrigin` is conditional (imports only) — we can't always tell domestic vs imported from
 *    the label, so it is surfaced as conditional, never a hard "missing".
 *  - `ageStatement` is conditional (e.g., whisky < 4 years); `appellation` is conditional. These are
 *    surfaced for review, not failed by default.
 *  - `cider` is treated as wine (its default resolution in tolerances.ts) — the common apple/pear
 *    case at >= 7% ABV. Not modeled here: cider/wine < 7% ABV falls under FDA food-labeling
 *    jurisdiction (the FAA Act defines "wine" for labeling as >= 7% ABV), and malt-based cider is a
 *    malt beverage under Part 7.
 */
import type { BeverageClass } from "./types";

/** A label element the completeness check can evaluate. */
export type RequirementKey =
  | "brand"
  | "classType"
  | "alcoholContent"
  | "netContents"
  | "name"
  | "address"
  | "governmentWarning"
  | "countryOfOrigin"
  | "sulfiteDeclaration"
  | "ageStatement"
  | "appellation";

export interface RequirementSpec {
  key: RequirementKey;
  /** Human-facing label for the UI/CSV. */
  label: string;
  /** mandatory = always required for this class; conditional = required only in certain cases. */
  necessity: "mandatory" | "conditional";
  /** CFR basis, or the condition under which a conditional element applies. */
  note: string;
}

/** Mandatory elements common to every alcohol beverage >= 0.5% ABV (alcohol content is added
 *  per class — its necessity differs — so it is NOT in this shared head/tail). */
const COMMON_HEAD: RequirementSpec[] = [
  { key: "brand", label: "Brand name", necessity: "mandatory", note: "Required on the brand label." },
  { key: "classType", label: "Class / type designation", necessity: "mandatory", note: "Standard of identity." },
];
const COMMON_TAIL: RequirementSpec[] = [
  { key: "netContents", label: "Net contents", necessity: "mandatory", note: "e.g. 750 mL / 12 FL OZ." },
  { key: "name", label: "Producer / bottler name", necessity: "mandatory", note: "Name of the responsible party (bottler / producer / importer)." },
  { key: "address", label: "Producer / bottler address", necessity: "mandatory", note: "City and state (and street) of the responsible party." },
  { key: "governmentWarning", label: "Government warning", necessity: "mandatory", note: "27 CFR Part 16; ALL-CAPS bold 'GOVERNMENT WARNING:' prefix." },
];

// Alcohol content — necessity is class-specific (see the module header). Three variants:
const ALC_MANDATORY: RequirementSpec = {
  key: "alcoholContent",
  label: "Alcohol content",
  necessity: "mandatory",
  note: "Numeric % Alc./Vol. — mandatory (27 CFR 5.65 spirits; 4.36(a) wine > 14% ABV).",
};
const ALC_WINE_UNDER14: RequirementSpec = {
  key: "alcoholContent",
  label: "Alcohol content",
  necessity: "conditional",
  note: 'Numeric % Alc./Vol., OR a "table wine"/"light wine" designation may stand in for it on wine <= 14% ABV (27 CFR 4.36(a); tolerance 4.36(b)(1), 14% tax-class clamp 4.36(c)).',
};
const ALC_MALT: RequirementSpec = {
  key: "alcoholContent",
  label: "Alcohol content",
  necessity: "conditional",
  note: "Optional on malt beverages unless alcohol derives from added nonbeverage flavors/ingredients other than hops extract, or State law requires (27 CFR 7.63(a)(3), 7.65(a)).",
};

const COUNTRY_OF_ORIGIN: RequirementSpec = {
  key: "countryOfOrigin",
  label: "Country of origin",
  necessity: "conditional",
  note: "Mandatory for imported products (27 CFR 5.69 / 7.69; CBP rules 19 CFR 102/134).",
};
const SULFITES: RequirementSpec = {
  key: "sulfiteDeclaration",
  label: "Sulfite declaration",
  necessity: "conditional",
  note: "'Contains Sulfites' required only at >= 10 ppm SO2 (27 CFR 4.32(e)); the ppm is not determinable from the image, so an absent declaration is surfaced for review, never failed.",
};
const APPELLATION: RequirementSpec = {
  key: "appellation",
  label: "Appellation of origin",
  necessity: "conditional",
  note: "Mandatory when the label uses a varietal, a type of varietal significance, a semi-generic designation, a vintage date, an estate-bottled claim, or a 'Brand'-qualified name (27 CFR 4.34(b), 4.26, 4.27).",
};
const AGE_STATEMENT: RequirementSpec = {
  key: "ageStatement",
  label: "Age statement",
  necessity: "conditional",
  note: "Mandatory for whisky < 4 years and for brandy and certain other spirits (27 CFR 5.74).",
};

const WINE_UNDER14: RequirementSpec[] = [...COMMON_HEAD, ALC_WINE_UNDER14, ...COMMON_TAIL, SULFITES, APPELLATION, COUNTRY_OF_ORIGIN];
const WINE_OVER14: RequirementSpec[] = [...COMMON_HEAD, ALC_MANDATORY, ...COMMON_TAIL, SULFITES, APPELLATION, COUNTRY_OF_ORIGIN];

const REQUIREMENTS: Record<BeverageClass, RequirementSpec[]> = {
  distilledSpirits: [...COMMON_HEAD, ALC_MANDATORY, ...COMMON_TAIL, AGE_STATEMENT, COUNTRY_OF_ORIGIN],
  wineUnder14: WINE_UNDER14,
  wineOver14: WINE_OVER14,
  cider: WINE_UNDER14, // apple/pear cider >= 7% ABV -> wine <= 14% (see tolerances.ts); < 7% ABV is FDA-regulated, malt-based cider is Part 7 (see header note)
  maltBeverage: [...COMMON_HEAD, ALC_MALT, ...COMMON_TAIL, COUNTRY_OF_ORIGIN],
  // Conservative default: ABV mandatory + country-of-origin (conditional) like every concrete class;
  // class-specific elements (sulfites/appellation/age) can't be asserted without a known class.
  unknown: [...COMMON_HEAD, ALC_MANDATORY, ...COMMON_TAIL, COUNTRY_OF_ORIGIN],
};

/** The label elements TTB requires for a beverage class (mandatory + conditional). */
export function mandatoryElementsFor(cls: BeverageClass): RequirementSpec[] {
  return REQUIREMENTS[cls] ?? REQUIREMENTS.unknown;
}
