/**
 * beverageClass.ts — the single human-facing BeverageClass -> label map for the UI, so the single and
 * batch screens never drift. (The lowercase reason-string map in src/compare/comparators.ts is a
 * separate concern — it embeds the class in audit prose, not a UI chip.)
 */
import type { BeverageClass } from "@/domain";

export const CLASS_DISPLAY_LABEL: Record<BeverageClass, string> = {
  distilledSpirits: "Distilled spirits",
  wineUnder14: "Wine (≤14% ABV)",
  wineOver14: "Wine (>14% ABV)",
  maltBeverage: "Malt beverage",
  cider: "Cider",
  unknown: "Unknown beverage type",
};
