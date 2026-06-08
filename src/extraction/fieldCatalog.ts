/**
 * fieldCatalog.ts — THE single source of truth for the extracted field set.
 *
 * The extracted field list used to be re-typed by hand in ~6 places (the raw->domain mapper, the
 * front/back merge value list + confidence-key map, the UI field table, and the CSV columns), so a
 * new field meant editing all of them and the CSV silently drifted from the JSON. Every one of those
 * layers now derives from this ordered catalog — edit a field HERE and the plumbing follows.
 *
 * (The LLM json_schema + prose prompt in LlmVisionProvider.ts intentionally stay hand-written: each
 * field needs human-tuned extraction guidance, and over-generating the prompt would hurt accuracy.
 * They reference the same keys, so they stay in step by convention, not by generation.)
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
  | "appellation"
  | "vintage"
  | "varietal"
  | "sulfiteDeclaration"
  | "ageStatement"
  | "commodityStatement"
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
}

/**
 * THE ordered field list. Order is the UI/CSV display order. `group: "headline"` are the fields an
 * agent cares about at a glance (shown first); `group: "detail"` are the wine/spirits long tail
 * (behind a "show everything" disclosure). Adding a field is a one-line edit here.
 */
export const FIELD_CATALOG: readonly FieldDescriptor[] = [
  { key: "brand", rawKey: "brand", confKey: "brand", label: "Brand name", csvColumn: "brand", group: "headline" },
  { key: "classType", rawKey: "classType", confKey: "classType", label: "Class / type", csvColumn: "type", group: "headline" },
  { key: "alcoholContentText", rawKey: "alcoholContent", confKey: "alcoholContent", label: "Alcohol content", csvColumn: "alcohol", group: "headline" },
  { key: "netContents", rawKey: "netContents", confKey: "netContents", label: "Net contents", csvColumn: "net_contents", group: "headline" },
  { key: "warningText", rawKey: "warningText", confKey: "warningText", label: "Government warning", csvColumn: "warning_text", group: "headline" },
  { key: "class", rawKey: "class", confKey: "class", label: "Broad category", csvColumn: "class", group: "detail" },
  { key: "name", rawKey: "name", confKey: "name", label: "Producer / bottler name", csvColumn: "name", group: "detail" },
  { key: "address", rawKey: "address", confKey: "address", label: "Producer / bottler address", csvColumn: "address", group: "detail" },
  { key: "countryOfOrigin", rawKey: "countryOfOrigin", confKey: "countryOfOrigin", label: "Country of origin", csvColumn: "country_of_origin", group: "detail" },
  { key: "appellation", rawKey: "appellation", confKey: "appellation", label: "Appellation", csvColumn: "appellation", group: "detail" },
  { key: "vintage", rawKey: "vintage", confKey: "vintage", label: "Vintage", csvColumn: "vintage", group: "detail" },
  { key: "varietal", rawKey: "varietal", confKey: "varietal", label: "Varietal", csvColumn: "varietal", group: "detail" },
  { key: "sulfiteDeclaration", rawKey: "sulfiteDeclaration", confKey: "sulfiteDeclaration", label: "Sulfite declaration", csvColumn: "sulfites", group: "detail" },
  { key: "ageStatement", rawKey: "ageStatement", confKey: "ageStatement", label: "Age statement", csvColumn: "age_statement", group: "detail" },
  { key: "commodityStatement", rawKey: "commodityStatement", confKey: "commodityStatement", label: "Commodity statement", csvColumn: "commodity_statement", group: "detail" },
];

/** Catalog entries in the "headline" group (shown first in the UI). */
export const HEADLINE_FIELDS = FIELD_CATALOG.filter((d) => d.group === "headline");
/** Catalog entries in the "detail" group (the long tail, behind a disclosure). */
export const DETAIL_FIELDS = FIELD_CATALOG.filter((d) => d.group === "detail");
