/**
 * labelRequirements.ts — which label elements TTB requires, per beverage class.
 *
 * CFR-VERIFIED MODULE (extends the domain; see ./README.md). Sourced from TTB's mandatory-label-info
 * checklists for distilled spirits (27 CFR Part 5), wine (Part 4), and malt beverages (Part 7), plus
 * the health-warning rule (Part 16). The completeness check (src/compare/completeness.ts) reads this
 * matrix to flag each mandatory element as present / missing / malformed.
 *
 * Pragmatic simplifications (documented, like tolerances.ts — do not silently "fix" these):
 *  - `alcoholContent` is listed mandatory for all classes. Real nuance: wine <=14% ABV may substitute
 *    a "table wine"/"light wine" class designation in lieu of a numeric statement, so a missing ABV on
 *    a table wine is a reviewable flag, not a true violation.
 *  - `countryOfOrigin` is conditional (imports only) — we can't always tell domestic vs imported from
 *    the label, so it is surfaced as conditional, never a hard "missing".
 *  - `ageStatement` is conditional (e.g., whisky < 4 years); `appellation` is conditional (required
 *    when a vintage or varietal is stated). These are surfaced for review, not failed by default.
 *  - `cider` is treated as wine (its default resolution in tolerances.ts).
 */
import type { BeverageClass } from "./types";

/** A label element the completeness check can evaluate. */
export type RequirementKey =
  | "brand"
  | "classType"
  | "alcoholContent"
  | "netContents"
  | "nameAndAddress"
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

/** Universal mandatory elements for any alcohol beverage > 0.5% ABV. */
const UNIVERSAL: RequirementSpec[] = [
  { key: "brand", label: "Brand name", necessity: "mandatory", note: "Required on the brand label." },
  { key: "classType", label: "Class / type designation", necessity: "mandatory", note: "Standard of identity." },
  { key: "alcoholContent", label: "Alcohol content", necessity: "mandatory", note: "Numeric % Alc./Vol." },
  { key: "netContents", label: "Net contents", necessity: "mandatory", note: "e.g. 750 mL / 12 FL OZ." },
  { key: "nameAndAddress", label: "Name & address", necessity: "mandatory", note: "Responsible party (bottler / producer / importer)." },
  { key: "governmentWarning", label: "Government warning", necessity: "mandatory", note: "27 CFR Part 16; ALL-CAPS bold 'GOVERNMENT WARNING:' prefix." },
];

const COUNTRY_OF_ORIGIN: RequirementSpec = {
  key: "countryOfOrigin",
  label: "Country of origin",
  necessity: "conditional",
  note: "Mandatory for imported products.",
};
const SULFITES: RequirementSpec = {
  key: "sulfiteDeclaration",
  label: "Sulfite declaration",
  necessity: "mandatory",
  note: "'Contains Sulfites' when >= 10 ppm (27 CFR 4.32(e)) — effectively all wine.",
};
const APPELLATION: RequirementSpec = {
  key: "appellation",
  label: "Appellation of origin",
  necessity: "conditional",
  note: "Mandatory when a vintage date or grape varietal is stated.",
};
const AGE_STATEMENT: RequirementSpec = {
  key: "ageStatement",
  label: "Age statement",
  necessity: "conditional",
  note: "Mandatory for whisky < 4 years and certain spirits (27 CFR Part 5).",
};

const WINE: RequirementSpec[] = [...UNIVERSAL, SULFITES, APPELLATION, COUNTRY_OF_ORIGIN];

const REQUIREMENTS: Record<BeverageClass, RequirementSpec[]> = {
  distilledSpirits: [...UNIVERSAL, AGE_STATEMENT, COUNTRY_OF_ORIGIN],
  wineUnder14: WINE,
  wineOver14: WINE,
  cider: WINE, // resolves to wine (see tolerances.ts)
  maltBeverage: [...UNIVERSAL, COUNTRY_OF_ORIGIN],
  unknown: [...UNIVERSAL], // can't assert class-specific elements
};

/** The label elements TTB requires for a beverage class (mandatory + conditional). */
export function mandatoryElementsFor(cls: BeverageClass): RequirementSpec[] {
  return REQUIREMENTS[cls] ?? UNIVERSAL;
}
