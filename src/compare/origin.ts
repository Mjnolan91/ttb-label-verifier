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
  "name" | "address" | "countryOfOrigin" | "class" | "classType" | "commodityStatement" | "importerStatement"
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
  // Territories whose products are domestic for TTB labeling, spelled out (abbrs are above).
  "puerto rico", "virgin islands", "us virgin islands", "u s virgin islands", "guam",
  "american samoa",
]);

/** US-country synonyms a printed origin statement may use. Exact matches only (after stripping the
 *  lead-in) — which is why bare "america" IS safe here: "Made in America" strips to exactly
 *  "america" (the most common domestic marketing phrase), while "South America" never equals it.
 *  The substring-scanning namedCountryIn deliberately does NOT use "america" (see below). */
const US_COUNTRY_SYNONYMS = new Set(["usa", "us", "u s", "u s a", "united states", "united states of america", "america"]);

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

/**
 * English names of foreign countries, for the structured "City, Country" address form — a label
 * whose responsibility line reads "… Valencia, Spain" is an import even when nothing says
 * "imported" (the producer line alone is a lawful imported-wine pattern, 27 CFR 4.35(b)).
 * Matched by EXACT equality against the address TAIL segment only — so "Lebanon, KY" (a US town;
 * its tail is the state) and "Albuquerque, New Mexico" (exact !== "mexico") never match.
 * "Georgia" is deliberately ABSENT (US-state collision: an Atlanta label must never read as
 * imported); the accepted cost is that a Tbilisi, Georgia label ALSO matches the US state name
 * and reads "domestic" — the one collision that errs that way; the reviewer sees the address
 * either way. Any OTHER name missing from this list is a miss toward "unknown" (neutral).
 * Non-English spellings ("Deutschland", "España") and Canadian provinces are documented misses.
 */
const FOREIGN_COUNTRY_NAMES = new Set([
  "france", "italy", "spain", "portugal", "germany", "austria", "switzerland", "belgium",
  "netherlands", "holland", "luxembourg", "ireland", "northern ireland", "united kingdom",
  "great britain", "england", "scotland", "wales", "greece", "hungary", "romania", "bulgaria",
  "croatia", "slovenia", "serbia", "albania", "north macedonia", "armenia", "moldova", "ukraine",
  "russia", "poland", "czech republic", "czechia", "slovakia", "denmark", "sweden", "norway",
  "finland", "iceland", "estonia", "latvia", "lithuania", "malta", "cyprus", "turkey",
  "mexico", "canada", "brazil", "argentina", "chile", "uruguay", "paraguay", "bolivia", "peru",
  "colombia", "venezuela", "ecuador", "guatemala", "nicaragua", "panama", "costa rica",
  "honduras", "belize", "el salvador", "cuba", "jamaica", "haiti", "dominican republic",
  "barbados", "trinidad", "trinidad and tobago", "bahamas", "guyana", "suriname",
  "japan", "china", "india", "south korea", "korea", "taiwan", "thailand", "vietnam",
  "philippines", "indonesia", "singapore", "malaysia", "sri lanka", "nepal", "mongolia",
  "australia", "new zealand", "fiji",
  "south africa", "kenya", "ethiopia", "tanzania", "uganda", "nigeria", "ghana", "morocco",
  "tunisia", "algeria", "egypt", "israel", "lebanon", "jordan",
  "uk", "u k", "bosnia and herzegovina",
  // Common ENDONYMS seen on imported labels (normalize() already folds diacritics, so "España"
  // arrives here as "espana"). A small, deliberate set: the wine/spirits exporters whose labels
  // most often print the native name. Anything missing still routes to review, never to fail.
  "espana", "italia", "deutschland", "brasil", "osterreich",
]);

const normalize = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // fold combining diacritics: "México" -> "Mexico"
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,;:!?'"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether a printed origin statement names the United States (vs a foreign country).
 *  A leading article is folded ("Made in the USA" -> "usa"). */
function isUsOriginText(text: string): boolean {
  return US_COUNTRY_SYNONYMS.has(normalize(text.replace(ORIGIN_PREFIX, "")).replace(/^the\s+/, ""));
}

/** The address TAIL — the last comma segment that names a PLACE: a trailing postcode-only
 *  segment ("…, France, 25300") is dropped, then a trailing digit run and punctuation are
 *  stripped — "MD 21201-1234" -> "md", "N.Y." -> "n y", "Spain." -> "spain". "" when the
 *  address has fewer than two place segments (a bare name is never judged). */
function addressTail(address: string | undefined): string {
  const raw = (address ?? "").trim();
  if (raw === "") return "";
  const segments = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
  while (segments.length > 0 && /^\d[\d\s-]*$/.test(segments[segments.length - 1])) segments.pop();
  if (segments.length < 2) return "";
  return normalize(segments[segments.length - 1].replace(/\s+\d[\d-]*$/, ""));
}

/**
 * Whether an extracted producer/bottler address is in the United States. Matches only the
 * structured "City, ST [ZIP]" / "City, StateName" / "City, ST, USA" forms — and judges the TAIL
 * segment ONLY, so free text containing state-like letter pairs ("MADE IN OAK BARRELS") never
 * triggers, and a US-state-lookalike EARLIER in a foreign address ("Modena, MO, Italy" — Italian
 * province codes collide with state abbreviations) can never veto the explicit foreign tail.
 */
export function isUsAddress(address: string | undefined): boolean {
  const tail = addressTail(address);
  if (tail === "") return false;
  if (US_COUNTRY_SYNONYMS.has(tail)) return true; // "…, USA"
  // normalize() spaces out punctuation, so compare the de-spaced form against the abbr set
  // ("n y" -> "NY", "d c" -> "DC") and the spaced form against the state names ("new mexico").
  if (US_STATE_ABBR.has(tail.replace(/\s+/g, "").toUpperCase())) return true;
  return US_STATE_NAMES.has(tail);
}

/**
 * Whether an extracted producer/bottler address is positively FOREIGN: the structured
 * "City, Country" form whose TAIL segment names a known foreign country. A foreign producer
 * address is import evidence in its own right — the producer line alone ("PRODUCED & BOTTLED BY
 * X, VALENCIA, SPAIN") is a lawful imported-product pattern with nothing else saying "import".
 * The tail decides alone (the country list and the US state/synonym sets are disjoint), so a
 * state-lookalike EARLIER in the address ("Modena, MO, Italy") cannot veto the foreign tail,
 * and country-named US towns ("Lebanon, KY") never match because their tail is the state.
 */
export function isForeignAddress(address: string | undefined): boolean {
  return FOREIGN_COUNTRY_NAMES.has(addressTail(address));
}

/** Phrase-wise membership: does the normalized text contain `name` as whole word(s)? Returns the
 *  LONGEST matching name, so "Northern Ireland" resolves as itself, never as "Ireland". */
function containsName(normalized: string, names: ReadonlySet<string>): string | null {
  const padded = ` ${normalized} `;
  let best: string | null = null;
  for (const name of names) {
    if (padded.includes(` ${name} `) && (best === null || name.length > best.length)) best = name;
  }
  return best;
}

/**
 * The country a printed origin statement actually NAMES, or null when it names none. "Imported
 * from the Caribbean" matches an application that says the same thing, but it is not a lawful
 * marking: the CBP rules the TTB origin sections incorporate (19 CFR 134; 27 CFR 5.69 / 7.69 /
 * 4.35(e)) require the COUNTRY of origin, and "the Caribbean" is a region. This check powers the
 * match-is-not-compliance validation in compareOrigin and the completeness malformed path: a
 * statement can agree with the application and still need a human to fix it to "Product of
 * Barbados". Conservative on purpose: an obscure country missing from the list reads as
 * "names no country" and routes to REVIEW (a person confirms), never to fail.
 */
export function namedCountryIn(text: string | undefined): string | null {
  const norm = normalize(text ?? "");
  if (norm === "") return null;
  const foreign = containsName(norm, FOREIGN_COUNTRY_NAMES);
  if (foreign) return foreign;
  // US forms count as naming a country ("Product of the USA", "Made in America"). EXACT matching
  // only, via isUsOriginText: a substring scan would read "South America" as the US form.
  return isUsOriginText(text ?? "") ? "united states" : null;
}

/**
 * Fold a recognized country name to its CANONICAL country, so the comparator can see that "UK",
 * "Scotland", and "United Kingdom" describe the same origin (CBP treats the UK as the country of
 * origin for its constituent countries), "Holland" is the Netherlands, and the endonyms map to
 * their English names. Null when the text names no recognized country.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  uk: "united kingdom",
  "u k": "united kingdom",
  "great britain": "united kingdom",
  england: "united kingdom",
  scotland: "united kingdom",
  wales: "united kingdom",
  "northern ireland": "united kingdom",
  holland: "netherlands",
  espana: "spain",
  italia: "italy",
  deutschland: "germany",
  brasil: "brazil",
  osterreich: "austria",
  korea: "south korea",
  trinidad: "trinidad and tobago",
  czechia: "czech republic",
};

export function canonicalCountry(text: string | undefined): string | null {
  const named = namedCountryIn(text);
  if (named === null) return null;
  return COUNTRY_ALIASES[named] ?? named;
}

/** The foreign country a structured producer address ends in ("Bridgetown, Barbados." ->
 *  "barbados"), or null. Used to SUGGEST the likely intended country when a printed origin
 *  statement names a region instead of a country. */
export function foreignCountryFromAddress(address: string | undefined): string | null {
  const tail = addressTail(address);
  return FOREIGN_COUNTRY_NAMES.has(tail) ? tail : null;
}

/** Title-case a normalized country name for display: "dominican republic" -> "Dominican Republic". */
export function displayCountry(name: string): string {
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Classify the label's origin from its own text. Import evidence — an "imported …" phrase in any
 * responsibility text, a separate importer statement, a FOREIGN producer address, a
 * foreign-distinctive class designation, or a printed non-US origin statement — always wins; a US
 * address or a printed US origin statement reads domestic only in its absence; otherwise unknown.
 */
export function inferOrigin(e: OriginEvidence): OriginInference {
  const origin = (e.countryOfOrigin ?? "").trim();
  const importEvidence =
    IMPORT_PHRASE.test(e.name ?? "") ||
    IMPORT_PHRASE.test(e.address ?? "") ||
    IMPORT_PHRASE.test(e.commodityStatement ?? "") ||
    // Deliberately confidence-blind: a low-confidence "IMPORTED BY …" read still routes the label
    // to review (the safe direction); the self-consistency presence vote already drops a one-off
    // hallucinated sample before it gets here.
    IMPORT_PHRASE.test(e.importerStatement ?? "") ||
    isForeignAddress(e.address) ||
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
