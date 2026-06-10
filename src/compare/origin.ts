/**
 * compare/origin.ts — deterministic domestic-vs-imported inference from the label's own text.
 *
 * Country of origin is mandatory for IMPORTED products only — 27 CFR 5.69 (spirits) / 7.69 (malt) /
 * 4.35(e) (wine) all cross-reference the CBP marking rules (19 CFR 102/134), and 19 CFR 134.11
 * reaches only articles of FOREIGN origin. A domestic label ("Bottled by Old Tom Distillery,
 * Baltimore, MD") carries none, and prompting a reviewer for one is noise. This module classifies a
 * label as domestic / imported / unknown from its own extracted text, so:
 *  - the completeness check can say "not applicable on its face" instead of "confirm for imports",
 *    and can flag a label with import evidence but NO printed country (a genuine missing element);
 *  - the UI can stop suggesting a country into the imports-only application input for a domestic
 *    product (a vision model sometimes infers "USA" from the address; the field is for printed
 *    import statements only).
 *
 * ASYMMETRY (mirrors the thresholds philosophy): the costly mistake is a wrong "domestic" — it would
 * suppress a genuinely mandatory import statement. So import evidence ALWAYS wins over a US address
 * (imports bottled in the US legally carry one, 27 CFR 5.67(b)), and "domestic" requires positive US
 * evidence in the structured City, ST address form, never a guess. No evidence either way stays
 * "unknown" and keeps today's neutral behavior.
 *
 * Documented limitation: a spirit imported in bottles and US-bottled may read just "Bottled by X,
 * Baltimore, MD" (27 CFR 5.67(b)(1)) — if it ALSO omits its CBP-mandatory "Product of X" marking
 * (19 CFR 134.11/134.46), nothing on the label says "import" and this classifier reads it domestic.
 * That gap needs customs records, not the label — the same boundary as the repo's no-registry-rules
 * non-goal. The foreign-distinctive designations below (Scotch/Irish/Canadian whisky, Tequila,
 * Mezcal, Cognac — 27 CFR 5.143(c)/5.145/5.148) close the common cases.
 */
import type { ExtractedFields } from "@/domain";

export type OriginInference = "domestic" | "imported" | "unknown";

/** The extracted fields origin inference consults. */
export type OriginEvidence = Pick<
  ExtractedFields,
  "name" | "address" | "countryOfOrigin" | "class" | "classType" | "commodityStatement"
>;

/** USPS state abbreviations, DC, and the territories whose products are domestic for TTB labeling
 *  (Puerto Rico / USVI / Guam products are not "imported" under the FAA Act). Excludes Canadian
 *  province codes (ON, BC, …) by simply not listing them. */
const US_STATE_ABBR = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC", "PR", "VI", "GU",
]);

const US_STATE_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
  "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
  "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia",
  "puerto rico",
]);

/** US-country synonyms a printed origin statement may use. Exact matches only (after stripping the
 *  lead-in); bare "america" is deliberately absent (ambiguous: "South America"). */
const US_COUNTRY_SYNONYMS = new Set(["usa", "us", "u s", "u s a", "united states", "united states of america"]);

/** "Product of …" / "Made in …" lead-ins, mirrored from the origin comparator. */
const ORIGIN_PREFIX = /^(?:product of|produce of|made in|bottled in|imported from)\s+/i;

/** The labeling phrases that positively indicate an import ("Imported by …", "Imported and bottled
 *  by …"). Word-bounded on "imported"/"importer" so an entity NAME like "Sea Trader Imports" (the
 *  plural noun) never matches. */
const IMPORT_PHRASE = /\bimported\b|\bimporter\b/i;

/** Class designations that are distinctive of a FOREIGN origin by regulation — a label may carry
 *  one with a US bottler address and no "imported by" line (27 CFR 5.67(b)), so the designation
 *  itself is import evidence: Scotch/Irish/Canadian whisky (27 CFR 5.143(c)), Cognac (5.145),
 *  Tequila/Mezcal (5.148). "Scotch" is matched only before "whisk(e)y" — Scotch Ale is a domestic
 *  malt style. A false "imported" is the safe direction (it only asks a human for the country). */
const FOREIGN_DISTINCTIVE_CLASS = /\bscotch\s+whisk|\birish\s+whisk|\bcanadian\s+whisk|\btequila\b|\bmezcal\b|\bcognac\b/i;

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[.,;:!?'"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether a printed origin statement names the United States (vs a foreign country). */
function isUsOriginText(text: string): boolean {
  return US_COUNTRY_SYNONYMS.has(normalize(text.replace(ORIGIN_PREFIX, "")));
}

/**
 * Whether an extracted producer/bottler address is in the United States. Matches only the
 * structured "City, ST [ZIP]" / "City, StateName" forms (with an optional trailing USA), so
 * free text containing state-like letter pairs ("MADE IN OAK BARRELS") never triggers.
 */
export function isUsAddress(address: string | undefined): boolean {
  const raw = (address ?? "").trim();
  if (raw === "") return false;
  // Work on the text after the LAST comma-separated segments: "Baltimore, MD 21201", or
  // "Baltimore, MD, USA" (then the segment before the USA suffix carries the state).
  const segments = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  if (segments.length < 2) return false;
  const tail = [...segments].reverse();
  for (const segment of tail.slice(0, 2)) {
    // Strip a ZIP and a trailing period: "MD 21201-1234" / "KY." -> "MD" / "KY".
    const noZip = segment.replace(/\s+\d{5}(?:-\d{4})?$/, "").replace(/\.$/, "").trim();
    if (US_STATE_ABBR.has(noZip.toUpperCase())) return true;
    if (US_STATE_NAMES.has(noZip.toLowerCase())) return true;
    if (US_COUNTRY_SYNONYMS.has(normalize(noZip))) return true;
  }
  return false;
}

/**
 * Classify the label's origin from its own text. Import evidence — an "imported …" phrase in the
 * responsibility line (name/address/commodity statement), a foreign-distinctive class designation,
 * or a printed non-US origin statement — always wins; a US address or a printed US origin statement
 * reads domestic only in its absence; otherwise unknown.
 */
export function inferOrigin(e: OriginEvidence): OriginInference {
  const origin = (e.countryOfOrigin ?? "").trim();
  const importEvidence =
    IMPORT_PHRASE.test(e.name ?? "") ||
    IMPORT_PHRASE.test(e.address ?? "") ||
    IMPORT_PHRASE.test(e.commodityStatement ?? "") ||
    FOREIGN_DISTINCTIVE_CLASS.test(e.classType ?? "") ||
    FOREIGN_DISTINCTIVE_CLASS.test(e.class ?? "") ||
    (origin !== "" && !isUsOriginText(origin));
  if (importEvidence) return "imported";
  if (isUsAddress(e.address) || (origin !== "" && isUsOriginText(origin))) return "domestic";
  return "unknown";
}

/**
 * The country-of-origin value the UI should SUGGEST into the application's imports-only input:
 * the printed statement for an import, nothing for a domestic product (even when the label prints
 * "Product of USA" — the application's country field is for imports, and a model sometimes infers
 * a US country from the address; the extracted-fields table still shows what was read).
 */
export function suggestedCountryOfOrigin(e: OriginEvidence): string | undefined {
  const origin = (e.countryOfOrigin ?? "").trim();
  if (origin === "") return undefined;
  return inferOrigin(e) === "domestic" ? undefined : origin;
}
