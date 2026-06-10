/**
 * fieldHelpCopy.ts — the helper copy behind each application input's "?" toggletip, in one place (the
 * same single-source pattern as beverageClass.ts). Keys match VerifyForm's appInputs keys exactly;
 * a unit test asserts the coverage and the copy standard (TTB vocabulary, no em dashes).
 */
import type { RequirementKey } from "@/domain";

/** The application-input keys on the verify screen (each renders a help toggletip). VerifyForm types
 *  its appInputs with this, so adding an input without help copy is a compile error, not a silent gap. */
export type AppInputKey = Extract<
  RequirementKey,
  | "brand"
  | "classType"
  | "alcoholContent"
  | "netContents"
  | "name"
  | "address"
  | "countryOfOrigin"
  | "statementOfComposition"
> | "fancifulName";

export const APP_FIELD_HELP: Record<AppInputKey, string> = {
  brand:
    "The name the product is sold under, exactly as the application states it. If the label shows " +
    "no separate brand, the producer's name serves as the brand name.",
  classType:
    "What the product is, in TTB's terms: the class or type designation. Examples: Kentucky " +
    "Straight Bourbon Whiskey, Red Table Wine, India Pale Ale. A broad class on the application, " +
    "like distilled spirits, still matches the label's more specific designation.",
  alcoholContent:
    "The alcohol statement as the application states it, for example 45% Alc./Vol. (90 Proof). " +
    "Each beverage class has its own legal tolerance between the stated and actual values.",
  netContents:
    "The container volume, for example 750 mL. Spirits and wine must use an authorized standard " +
    "of fill.",
  name: "The producer, bottler, or importer named on the application. The label must carry the same name.",
  address:
    "The city and state (or country) printed with the producer or bottler name on the label.",
  countryOfOrigin: "Required for imported products only. Leave blank for domestic products.",
  fancifulName:
    "A distinctive or fanciful name is additional branding text beyond the brand name, like " +
    "Midnight Reserve. Not every product has one; leave blank if the application lists none.",
  statementOfComposition:
    "Required for specialty products with no standard of identity: what the product is made from, " +
    "like Whiskey with natural flavors. Leave blank unless the application lists one.",
};
