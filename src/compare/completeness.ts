/**
 * completeness.ts — the extraction-first verification: does the label carry every element TTB
 * requires for its beverage class? Reads the requirements matrix (src/domain/labelRequirements.ts)
 * and the extracted fields, and flags each element present / missing / malformed / unverifiable.
 *
 * Conservative by design (mirrors the comparator's "minimize false approvals"): a mandatory element
 * we can't see is surfaced as a flag for a human, not silently passed. The government warning reuses
 * the strict format check (ALL-CAPS prefix; bold when detectable).
 */
import type { BeverageClass, ExtractedFields, RequirementKey, RequirementSpec } from "@/domain";
import { mandatoryElementsFor } from "@/domain";
import { resolveBeverageClass } from "./alcohol";
import { FIELD_REVIEW_CONFIDENCE } from "./thresholds";

export type ElementStatus = "present" | "missing" | "malformed" | "unverifiable";
export type CompletenessOverall = "complete" | "incomplete" | "review";

export interface CompletenessElement {
  key: RequirementKey;
  label: string;
  necessity: "mandatory" | "conditional";
  status: ElementStatus;
  /** What was found / why this status. */
  detail: string;
  /** The extracted value, when present. */
  value?: string;
}

export interface CompletenessResult {
  beverageClass: BeverageClass;
  elements: CompletenessElement[];
  overall: CompletenessOverall;
}

/** The extracted value + confidence backing a requirement key. */
function fieldFor(key: RequirementKey, e: ExtractedFields): { value?: string; confidence?: number } {
  switch (key) {
    case "brand":
      return { value: e.brand, confidence: e.confidence.brand };
    case "classType":
      return { value: e.classType, confidence: e.confidence.classType };
    case "alcoholContent":
      return { value: e.alcoholContentText, confidence: e.confidence.alcoholContent };
    case "netContents":
      return { value: e.netContents, confidence: e.confidence.netContents };
    case "nameAndAddress":
      return { value: e.nameAndAddress, confidence: e.confidence.nameAndAddress };
    case "countryOfOrigin":
      return { value: e.countryOfOrigin, confidence: e.confidence.countryOfOrigin };
    case "sulfiteDeclaration":
      return { value: e.sulfiteDeclaration, confidence: e.confidence.sulfiteDeclaration };
    case "ageStatement":
      return { value: e.ageStatement, confidence: e.confidence.ageStatement };
    case "appellation":
      return { value: e.appellation, confidence: e.confidence.appellation };
    case "governmentWarning":
      return { value: e.warningText, confidence: e.confidence.warningText };
  }
}

function evalWarning(spec: RequirementSpec, e: ExtractedFields): CompletenessElement {
  const w = e.warningText;
  const has = typeof w === "string" && w.trim() !== "";
  if (!has) {
    return { ...base(spec), status: "missing", detail: "Government warning not found on the label." };
  }
  const issues: string[] = [];
  if (!e.warningPrefixIsAllCaps) issues.push("prefix not ALL CAPS");
  if (e.warningPrefixIsBold === false) issues.push("prefix not bold");
  if (issues.length > 0) {
    return { ...base(spec), status: "malformed", value: w, detail: `${issues.join("; ")} (27 CFR 16.22(a)(2)).` };
  }
  return { ...base(spec), status: "present", value: w, detail: "Present with an ALL-CAPS prefix." };
}

function base(spec: RequirementSpec): Pick<CompletenessElement, "key" | "label" | "necessity"> {
  return { key: spec.key, label: spec.label, necessity: spec.necessity };
}

/**
 * Evaluate every required element for the label's beverage class. The class is taken from the
 * extracted `beverageClass`, falling back to resolving it from the class/type text.
 */
export function checkCompleteness(extracted: ExtractedFields): CompletenessResult {
  const beverageClass: BeverageClass =
    extracted.beverageClass ?? resolveBeverageClass(extracted.classType, extracted.alcoholContent?.abv);

  let lowConfidencePresent = false;
  const elements = mandatoryElementsFor(beverageClass).map((spec): CompletenessElement => {
    if (spec.key === "governmentWarning") return evalWarning(spec, extracted);

    const { value, confidence } = fieldFor(spec.key, extracted);
    const hasValue = typeof value === "string" && value.trim() !== "";
    if (hasValue) {
      const lowConf = confidence === undefined || confidence < FIELD_REVIEW_CONFIDENCE;
      if (lowConf) lowConfidencePresent = true;
      return {
        ...base(spec),
        status: "present",
        value,
        detail: lowConf ? `Found (low confidence — verify): "${value}"` : `Found: "${value}"`,
      };
    }
    if (spec.necessity === "mandatory") {
      return { ...base(spec), status: "missing", detail: "Required but not found on the label." };
    }
    return { ...base(spec), status: "unverifiable", detail: spec.note };
  });

  // A mandatory element missing or malformed => incomplete. A merely uncertain READ (low confidence
  // on something we did find) => review. Conditional elements that are simply absent are neutral
  // (a domestic spirit with no age statement is complete, not a problem).
  const mandatoryIssue = elements.some(
    (el) => el.necessity === "mandatory" && (el.status === "missing" || el.status === "malformed"),
  );
  const overall: CompletenessOverall = mandatoryIssue
    ? "incomplete"
    : lowConfidencePresent
      ? "review"
      : "complete";

  return { beverageClass, elements, overall };
}
