/**
 * beverageClass.ts — the single human-facing BeverageClass -> label map for the UI, so the single and
 * batch screens never drift. (The lowercase reason-string map in src/compare/comparators.ts is a
 * separate concern — it embeds the class in audit prose, not a UI chip.)
 */
import type { BeverageClass } from "@/domain";
import type { ClassChoice } from "@/compare";

export const CLASS_DISPLAY_LABEL: Record<BeverageClass, string> = {
  distilledSpirits: "Distilled spirits",
  wineUnder14: "Wine (≤14% ABV)",
  wineOver14: "Wine (>14% ABV)",
  maltBeverage: "Malt beverage",
  cider: "Cider",
  unknown: "Unknown beverage type",
};

/** The five human-facing selector choices, in display order (unknown = "Other / not sure"). */
export const CLASS_CHOICES: readonly ClassChoice[] = [
  "distilledSpirits", "wine", "maltBeverage", "cider", "unknown",
];

export const CLASS_CHOICE_LABEL: Record<ClassChoice, string> = {
  distilledSpirits: "Distilled spirits",
  wine: "Wine",
  maltBeverage: "Malt beverage",
  cider: "Cider",
  unknown: "Other / not sure",
};

/** The coarse selector choice for a resolved fine BeverageClass (both wine tiers collapse to "wine"). */
export function coarseClassOf(cls: BeverageClass): ClassChoice {
  switch (cls) {
    case "wineUnder14":
    case "wineOver14":
      return "wine";
    case "distilledSpirits":
    case "maltBeverage":
    case "cider":
    case "unknown":
      return cls;
  }
}
