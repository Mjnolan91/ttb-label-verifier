/**
 * appInputs.ts — THE single descriptor of the nine application inputs (label, hint, and how each
 * maps onto the extracted reading), shared by the single screen (VerifyForm) and the batch drawer
 * (ApplicationEditor). The two screens deliberately differ in INTERACTION (Tab-to-accept on the page
 * vs an explicit "Use suggestion" button inside the focus-trapped Drawer), but the descriptor data
 * and the suggestion/confidence mapping must be ONE source — this very list once lived in both files
 * and a suggestion-policy change had to be made twice. Same single-source pattern as fieldCatalog
 * ("add a field here, not in six places") and fieldHelpCopy ("copy lives ONCE").
 *
 * Adding an input: extend AppInputKey + APP_FIELD_HELP (compile-enforced), add its row to SPEC below
 * (compile-enforced) and its position in APP_INPUT_ORDER (unit-test-enforced), then cover the two
 * Partial-typed gaps by hand: applicationFromCsv + deriveProductVerdict's toClaimedFields literal
 * (src/app/batch/productVerdict.ts) and the CSV header aliases (src/batch/csv.ts).
 */
import type { ExtractedFields } from "@/domain";
import { suggestedCountryOfOrigin } from "@/compare";
import type { AppInputKey } from "./fieldHelpCopy";

export interface AppInputSpec {
  key: AppInputKey;
  label: string;
  hint?: string;
}

/** Per-input copy, keyed so a new AppInputKey without a row is a compile error. */
const SPEC: Record<AppInputKey, { label: string; hint?: string }> = {
  brand: { label: "Brand name" },
  classType: { label: "Class / type" },
  alcoholContent: { label: "Alcohol content" },
  netContents: { label: "Net contents" },
  name: { label: "Producer / bottler name" },
  address: { label: "Producer / bottler address" },
  countryOfOrigin: { label: "Country of origin", hint: "imports only" },
  fancifulName: { label: "Distinctive / fanciful name", hint: "if any" },
  statementOfComposition: { label: "Statement of composition", hint: "specialties" },
};

/** Display order (a unit test asserts it covers every key of SPEC). */
export const APP_INPUT_ORDER: readonly AppInputKey[] = [
  "brand",
  "classType",
  "alcoholContent",
  "netContents",
  "name",
  "address",
  "countryOfOrigin",
  "fancifulName",
  "statementOfComposition",
];

export const APP_INPUT_SPECS: readonly AppInputSpec[] = APP_INPUT_ORDER.map((key) => ({ key, ...SPEC[key] }));

/**
 * The AI's suggested value for one input: the specific class/type designation falls back to the
 * broad class; alcohol is carried as text; country of origin is suggested ONLY for an import
 * (suggestedCountryOfOrigin suppresses an inferred-domestic value — the field is imports-only).
 */
export function appInputSuggestion(extracted: ExtractedFields, key: AppInputKey): string | undefined {
  if (key === "countryOfOrigin") return suggestedCountryOfOrigin(extracted);
  if (key === "classType") return extracted.classType?.trim() ? extracted.classType : extracted.class;
  if (key === "alcoholContent") return extracted.alcoholContentText;
  return (extracted as unknown as Record<string, string | undefined>)[key];
}

/** The read confidence behind that suggestion (class/type mirrors the suggestion's fallback). */
export function appInputConfidence(extracted: ExtractedFields, key: AppInputKey): number | undefined {
  if (key === "classType") return extracted.confidence.classType ?? extracted.confidence.class;
  if (key === "alcoholContent") return extracted.confidence.alcoholContent;
  return extracted.confidence[key as keyof ExtractedFields["confidence"]] as number | undefined;
}
