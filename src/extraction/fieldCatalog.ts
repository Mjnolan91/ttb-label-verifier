/**
 * fieldCatalog.ts — THE single source of truth for the extracted field set.
 *
 * The extracted field list used to be re-typed by hand in ~6 places (the raw->domain mapper, the
 * front/back merge value list + confidence-key map, the UI field table, and the CSV columns), so a
 * new field meant editing all of them and the CSV silently drifted from the JSON. Every one of those
 * layers now derives from this ordered catalog — edit a field HERE and the plumbing follows.
 *
 * Per-field extraction instructions live as `description` on each descriptor and are promoted into
 * the structured-output schema (json_schema / responseSchema) so the model reads them as field-level
 * guidance. Google research shows duplicating the schema shape in the prompt LOWERS output quality,
 * so the prose USER_PROMPT is now a short framing paragraph only.
 */
import type { ExtractedFields, FieldConfidence } from "@/domain";

/** Keys on ExtractedFields that hold a string value carried as { value, confidence }. */
export type ExtractedValueKey = Extract<
  keyof ExtractedFields,
  | "brand"
  | "class"
  | "classType"
  | "alcoholContentText"
  | "netContents"
  | "warningText"
  | "name"
  | "address"
  | "countryOfOrigin"
  | "importerStatement"
  | "appellation"
  | "vintage"
  | "varietal"
  | "sulfiteDeclaration"
  | "ageStatement"
  | "commodityStatement"
  | "fancifulName"
  | "statementOfComposition"
>;

export interface FieldDescriptor {
  /** The ExtractedFields value key. */
  key: ExtractedValueKey;
  /** The RawExtractedFields key (differs from `key` only for the alcohol text field). */
  rawKey: string;
  /** The FieldConfidence channel backing this value. */
  confKey: keyof FieldConfidence;
  /** Human-facing label (UI rows + CSV header source). */
  label: string;
  /** Stable CSV column id. */
  csvColumn: string;
  /** Progressive-disclosure grouping: the few fields an agent reads first vs the long tail. */
  group: "headline" | "detail";
  /**
   * Per-field extraction instruction. Becomes the schema property `description` (the model reads
   * it as a field-level rule). Port guidance from the prose prompt here so it travels with the
   * schema and never drifts from the field definition.
   */
  description: string;
}

/**
 * THE ordered field list. Order is the UI/CSV display order. `group: "headline"` are the fields an
 * agent cares about at a glance (shown first); `group: "detail"` are the wine/spirits long tail
 * (behind a "show everything" disclosure). Adding a field is a one-line edit here.
 */
export const FIELD_CATALOG: readonly FieldDescriptor[] = [
  {
    key: "brand", rawKey: "brand", confKey: "brand", label: "Brand name", csvColumn: "brand", group: "headline",
    description:
      "The BRAND NAME — in TTB's terms, the name under which the product (or line of products) is SOLD, shown " +
      "in the primary masthead / wordmark, e.g. \"Stone's Throw\", \"Jolly Jerry's\". Per TTB, if the product is " +
      "NOT sold under a separate brand name, the bottler / distiller / importer COMPANY NAME is treated as the " +
      "brand: so when the only prominent name is e.g. \"OLD TOM DISTILLERY\", populate BOTH `brand` and `name` " +
      "with it. Do NOT fold any of these into the brand: (a) the class/type designation (e.g. \"Rum\", " +
      "\"Straight Rye Whisky\" -> that is classType); (b) a distinctive or fanciful / \"sell\" name or descriptive " +
      "phrase (e.g. \"Spiced Rum\", \"Single Barrel\", \"Small Batch\", \"Reserve\") -> those are NOT the brand " +
      "name; (c) marketing puffery (\"Superior\", \"Premium\", \"Smooth\"). A masthead that is the producer " +
      "company name OR AN ACRONYM / INITIALS / SHORTENING of it (e.g. a large \"ABC\" above the line " +
      "\"DISTILLED AND BOTTLED BY: ABC DISTILLERY\") is NOT a separate brand — the product has no distinct " +
      "brand, so put the FULL producer company name in BOTH `brand` AND `name` (brand \"ABC Distillery\", name " +
      "\"ABC Distillery\"). Only treat the masthead as the brand when it is a genuinely INDEPENDENT name that " +
      "is NOT the producer and NOT an abbreviation of it (e.g. masthead \"Stone's Throw\" with producer \"Acme " +
      "Spirits Co.\" -> brand \"Stone's Throw\", name \"Acme Spirits Co.\"). Test: would the masthead read as " +
      "the company name, or is it the company's initials / short form? If the latter, brand = the full producer " +
      "name. Transcribe verbatim; do not normalize. If unsure where a word belongs, lower the confidence so a " +
      "person can confirm.",
  },
  {
    key: "classType", rawKey: "classType", confKey: "classType", label: "Class / type", csvColumn: "type", group: "headline",
    description:
      "The TTB class/type DESIGNATION — the standard of identity that names what the product legally IS, " +
      "e.g. \"Rum\", \"Vodka\", \"Kentucky Straight Bourbon Whiskey\", \"India Pale Ale\", \"Cabernet Sauvignon\". " +
      "Capture the designation word(s) plus any qualifier that is PART OF the standard of identity (e.g. " +
      "\"Straight\", \"Blended\", \"Bottled in Bond\"). EXCLUDE purely promotional or fanciful adjectives that are " +
      "NOT part of the standard of identity — words like \"Superior\", \"Premium\", \"Finest\", \"Smooth\", " +
      "\"Handcrafted\", \"Award-Winning\", \"Legendary\". Example: on a label reading \"SUPERIOR CARIBBEAN RUM\" the " +
      "designation is \"Rum\" (\"Superior\" is marketing puffery; \"Caribbean\" is a geographic descriptor, not the " +
      "class). NEVER add a word that is not printed (do not write \"Spiced\", \"Reserve\", \"Aged\", etc. unless that " +
      "exact word appears). If you are unsure whether a word belongs in the designation, KEEP it but LOWER the " +
      "confidence so a person can confirm. Transcribe the designation words verbatim (preserve printed spelling/case). " +
      "SPECIALTY products that do NOT fit a standard of identity have no single class word: there, TTB treats the " +
      "distinctive or fanciful name TOGETHER WITH the statement of composition as the class/type designation — " +
      "capture that whole designation here (e.g. fanciful \"Spiced Rum\" + statement of composition " +
      "\"Rum with natural flavors added\"). A fanciful name alone (\"Spiced Rum\") does NOT by itself satisfy the " +
      "class/type requirement.",
  },
  {
    key: "alcoholContentText", rawKey: "alcoholContent", confKey: "alcoholContent", label: "Alcohol content", csvColumn: "alcohol", group: "headline",
    description:
      "The alcohol statement verbatim, e.g. \"45% Alc./Vol. (90 Proof)\", \"45% ALC/VOL\". Do not convert units or compute proof.",
  },
  {
    key: "netContents", rawKey: "netContents", confKey: "netContents", label: "Net contents", csvColumn: "net_contents", group: "headline",
    description:
      "Net contents as printed, including the quantity AND its unit, e.g. \"750 mL\", \"12 FL OZ\". " +
      "If the label shows BOTH a metric (mL/L) and a US-customary (fl oz/pint) measure, capture both. Transcribe verbatim.",
  },
  {
    key: "warningText", rawKey: "warningText", confKey: "warningText", label: "Government warning", csvColumn: "warning_text", group: "headline",
    description:
      "The FULL government warning, transcribed VERBATIM (exactly as printed) — from the \"GOVERNMENT WARNING:\" " +
      "prefix through \"...health problems.\" — including the EXACT capitalization of the prefix and the literal " +
      "\"(1)\" and \"(2)\" clause markers. Do NOT re-case, renumber, reword, or paraphrase any part. \"\" if absent.",
  },
  {
    key: "class", rawKey: "class", confKey: "class", label: "Broad category", csvColumn: "class", group: "detail",
    description:
      "The BROAD beverage category. This is the ONE field you may DERIVE rather than transcribe verbatim " +
      "(an explicit exception to the transcribe-only rule): infer it from the printed designation, e.g. " +
      "classType \"Kentucky Straight Bourbon Whiskey\" → class \"Whisky\", \"India Pale Ale\" → \"Malt beverage\", " +
      "\"Cabernet Sauvignon\" → \"Wine\".",
  },
  {
    key: "name", rawKey: "name", confKey: "name", label: "Producer / bottler name", csvColumn: "name", group: "detail",
    description:
      "The responsible-party COMPANY NAME only. It usually follows a verb like \"DISTILLED & BOTTLED BY:\", " +
      "\"PRODUCED BY\", \"IMPORTED BY\" — e.g. from \"DISTILLED AND BOTTLED BY: ABC DISTILLERY, FREDERICK, MD\" " +
      "the name is \"ABC Distillery\". Do NOT include the verb or the address. " +
      "NOTE: `name`, `address`, and `commodityStatement` are all parsed from the SAME printed responsibility " +
      "line — populate all three from it; do NOT leave name/address empty just because commodityStatement is filled. " +
      "When the label carries BOTH a producer/bottler line AND a separate \"IMPORTED BY …\" line, use the " +
      "producer/bottler line for name/address/commodityStatement and put the imported-by line (verbatim, whole) " +
      "in `importerStatement`.",
  },
  {
    key: "address", rawKey: "address", confKey: "address", label: "Producer / bottler address", csvColumn: "address", group: "detail",
    description:
      "The responsible-party ADDRESS only (street/city/state), e.g. \"Frederick, MD\". Separate from name. " +
      "NOTE: `name`, `address`, and `commodityStatement` are all parsed from the SAME printed responsibility " +
      "line — populate all three from it; do NOT leave address empty just because commodityStatement is filled.",
  },
  {
    key: "countryOfOrigin", rawKey: "countryOfOrigin", confKey: "countryOfOrigin", label: "Country of origin", csvColumn: "country_of_origin", group: "detail",
    description:
      "A PRINTED origin/import statement only, e.g. \"Product of Scotland\" (imports carry one). " +
      "NEVER infer a country from the producer/bottler address — a US city/state like \"Baltimore, MD\" " +
      "is the address, not a country of origin. \"\" if no origin statement is printed.",
  },
  {
    key: "importerStatement", rawKey: "importerStatement", confKey: "importerStatement", label: "Importer statement", csvColumn: "importer_statement", group: "detail",
    description:
      "The SEPARATE \"IMPORTED BY …\" responsibility statement, verbatim INCLUDING the verb, importer name, " +
      "and the importer's city/state, e.g. \"IMPORTED BY: SEA TRADER IMPORTS, MIAMI, FL.\" Imported products " +
      "often carry TWO responsibility lines — the producer's (\"PRODUCED & BOTTLED BY …\", which belongs in " +
      "name/address/commodityStatement) AND the importer's, which belongs HERE. Do NOT copy the producer line " +
      "into this field. \"\" if the label has no imported-by line.",
  },
  {
    key: "appellation", rawKey: "appellation", confKey: "appellation", label: "Appellation", csvColumn: "appellation", group: "detail",
    description: "Wine appellation of origin as printed, e.g. \"Napa Valley\". \"\" if none.",
  },
  {
    key: "vintage", rawKey: "vintage", confKey: "vintage", label: "Vintage", csvColumn: "vintage", group: "detail",
    description: "Wine vintage year as printed, e.g. \"2019\". \"\" if none.",
  },
  {
    key: "varietal", rawKey: "varietal", confKey: "varietal", label: "Varietal", csvColumn: "varietal", group: "detail",
    description: "Grape variety as printed, e.g. \"Cabernet Sauvignon\". \"\" if none.",
  },
  {
    key: "sulfiteDeclaration", rawKey: "sulfiteDeclaration", confKey: "sulfiteDeclaration", label: "Sulfite declaration", csvColumn: "sulfites", group: "detail",
    description: "Sulfite declaration as printed, e.g. \"Contains Sulfites\". \"\" if none.",
  },
  {
    key: "ageStatement", rawKey: "ageStatement", confKey: "ageStatement", label: "Age statement", csvColumn: "age_statement", group: "detail",
    description: "Age statement as printed, e.g. \"Aged 4 Years\". \"\" if none.",
  },
  {
    key: "commodityStatement", rawKey: "commodityStatement", confKey: "commodityStatement", label: "Commodity statement", csvColumn: "commodity_statement", group: "detail",
    description:
      "The full responsibility/commodity statement including the verb, e.g. " +
      "\"Distilled and bottled by ABC Distillery, Frederick, MD\". " +
      "NOTE: also populate `name` and `address` separately from this same line.",
  },
  {
    key: "fancifulName", rawKey: "fancifulName", confKey: "fancifulName", label: "Distinctive / fanciful name", csvColumn: "fanciful_name", group: "detail",
    description:
      "The distinctive or fanciful (\"sell\") name — a descriptive name/phrase shown IN ADDITION to the " +
      "brand to further identify the product, e.g. \"Spiced Rum\". It is NOT the brand name and NOT, by " +
      "itself, the class/type designation. It must be its OWN piece of printed text: NEVER copy, shorten, " +
      "or recombine words from the brand name, producer name, or class/type into this field (if a phrase " +
      "appears only inside the brand masthead, there is no fanciful name). Most labels have NONE — absence " +
      "is the normal case, so return \"\" rather than promoting other text. Capture it ONLY when the label " +
      "clearly presents such a separate sell name; ordinary marketing puffery (\"Superior\", \"Premium\") " +
      "is NOT a fanciful name. \"\" if none.",
  },
  {
    key: "statementOfComposition", rawKey: "statementOfComposition", confKey: "statementOfComposition", label: "Statement of composition", csvColumn: "statement_of_composition", group: "detail",
    description:
      "The statement of composition — a plain description of what the product is made of, e.g. " +
      "\"Rum with natural flavors added\", \"Neutral spirits with natural flavors and caramel color\". For a " +
      "SPECIALTY product (one with no standard of identity), the fanciful name + this statement TOGETHER serve " +
      "as the mandatory class/type designation (27 CFR 5.156; malt 27 CFR 7.141/7.147). Transcribe verbatim. " +
      "\"\" if none.",
  },
];

/** Catalog entries in the "headline" group (shown first in the UI). */
export const HEADLINE_FIELDS = FIELD_CATALOG.filter((d) => d.group === "headline");
/** Catalog entries in the "detail" group (the long tail, behind a disclosure). */
export const DETAIL_FIELDS = FIELD_CATALOG.filter((d) => d.group === "detail");
