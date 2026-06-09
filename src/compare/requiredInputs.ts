/**
 * compare/requiredInputs.ts — which APPLICATION INPUTS the law makes mandatory, per beverage type.
 *
 * The verify screen blocks a verdict until every field TTB requires for the detected/selected beverage
 * type is supplied. That required set is DYNAMIC and comes straight from the one CFR-verified matrix
 * (`mandatoryElementsFor`, src/domain/labelRequirements.ts) — no parallel rule list to drift. So
 * distilled spirits / wine >14% / unknown require a numeric alcohol statement (mandatory per 27 CFR
 * 5.65 / 4.36(a)), while wine ≤14% / malt / cider do NOT (table-wine substitution / malt-optional).
 *
 * This module also models the five plain, human-facing class CHOICES for the type selector — each a
 * token `resolveBeverageClass` already recognizes (wine → ≤14/>14 by ABV), so a human override and an
 * AI reading resolve through the SAME tested resolver, no parallel mapping.
 */
import { mandatoryElementsFor, type BeverageClass, type RequirementKey } from "@/domain";

/** The five plain class choices offered in the type selector (the ≤14/>14 wine split is derived from
 *  ABV in the domain layer, never a human pick — so a contradictory class/ABV state is impossible). */
export type ClassChoice = "distilledSpirits" | "wine" | "maltBeverage" | "cider" | "unknown";

export const CLASS_CHOICES: readonly { value: ClassChoice; label: string }[] = [
  { value: "distilledSpirits", label: "Distilled spirits" },
  { value: "wine", label: "Wine" },
  { value: "maltBeverage", label: "Malt beverage" },
  { value: "cider", label: "Cider" },
  { value: "unknown", label: "Other / not sure" },
];

/** Map a resolved fine BeverageClass back to the coarse selector choice (wine ≤14/>14 → "wine"). */
export function classChoiceFor(cls: BeverageClass): ClassChoice {
  if (cls === "wineUnder14" || cls === "wineOver14") return "wine";
  if (cls === "distilledSpirits" || cls === "maltBeverage" || cls === "cider") return cls;
  return "unknown";
}

/** The application inputs the agent can TYPE (the government warning is auto/derived, not typed). */
const TYPEABLE_KEYS: readonly RequirementKey[] = [
  "brand",
  "classType",
  "alcoholContent",
  "netContents",
  "name",
  "address",
];

/**
 * The typed application inputs that are MANDATORY for this class — the fields that must be supplied
 * before a verdict. Derived from the CFR matrix, so alcohol gates only where the law makes it mandatory
 * (spirits / wine >14% / unknown), not for wine ≤14% / malt / cider. Order follows TYPEABLE_KEYS.
 */
export function requiredInputKeysFor(cls: BeverageClass): RequirementKey[] {
  const mandatory = new Set(
    mandatoryElementsFor(cls)
      .filter((s) => s.necessity === "mandatory")
      .map((s) => s.key),
  );
  return TYPEABLE_KEYS.filter((k) => mandatory.has(k));
}
