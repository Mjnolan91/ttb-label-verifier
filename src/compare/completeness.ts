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
import { mandatoryElementsFor, isWarningRequired, CANONICAL_GOVERNMENT_WARNING } from "@/domain";
import { parseAlcoholText, resolveBeverageClass } from "./alcohol";
import { normalizeWarning } from "./text";
import { checkAlcoholInternalConsistency, validateNetContents } from "./comparators";
import { FIELD_REVIEW_CONFIDENCE } from "./thresholds";

/** The ABV parsed from the as-written alcohol statement, or undefined if absent/unparseable.
 *  Extraction carries alcohol as text only (no pre-parsed struct); parsing lives here, next to
 *  the comparator's parser, so the 0.5% exemption and the wine 14% split read a real number. */
function abvFromText(e: ExtractedFields): number | undefined {
  return parseAlcoholText(e.alcoholContentText).abv;
}

/** A "table wine"/"light wine" class designation can stand in for a numeric ABV on wine <= 14% ABV
 *  (27 CFR 4.36(a)). */
const TABLE_WINE_DESIGNATION = /\b(?:table|light)\s+wine\b/i;

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
  /** True when this element was FOUND but at low read confidence — the driver of an overall `review`.
   *  A human confirming the field resolves it (the supporting check recomputes to `complete`). */
  lowConfidence?: boolean;
}

export interface CompletenessResult {
  beverageClass: BeverageClass;
  elements: CompletenessElement[];
  overall: CompletenessOverall;
}

/** The extracted value + confidence backing a requirement key. Exported for reuse by confirm.ts. */
export function fieldFor(key: RequirementKey, e: ExtractedFields): { value?: string; confidence?: number } {
  switch (key) {
    case "brand":
      return { value: e.brand, confidence: e.confidence.brand };
    case "classType": {
      // Fall back to the broad `class` when the specific designation is empty, so a benign
      // class/classType mis-split doesn't read as a missing class/type designation.
      const v = e.classType?.trim() ? e.classType : e.class;
      return { value: v, confidence: e.confidence.classType ?? e.confidence.class };
    }
    case "alcoholContent":
      return { value: e.alcoholContentText, confidence: e.confidence.alcoholContent };
    case "netContents":
      return { value: e.netContents, confidence: e.confidence.netContents };
    case "name":
      return { value: e.name, confidence: e.confidence.name };
    case "address":
      return { value: e.address, confidence: e.confidence.address };
    case "countryOfOrigin":
      return { value: e.countryOfOrigin, confidence: e.confidence.countryOfOrigin };
    case "sulfiteDeclaration":
      return { value: e.sulfiteDeclaration, confidence: e.confidence.sulfiteDeclaration };
    case "ageStatement":
      return { value: e.ageStatement, confidence: e.confidence.ageStatement };
    case "appellation":
      return { value: e.appellation, confidence: e.confidence.appellation };
    case "statementOfComposition":
      return { value: e.statementOfComposition, confidence: e.confidence.statementOfComposition };
    case "governmentWarning":
      return { value: e.warningText, confidence: e.confidence.warningText };
  }
}

export function evaluateWarningElement(spec: RequirementSpec, e: ExtractedFields): CompletenessElement {
  const w = e.warningText;
  const has = typeof w === "string" && w.trim() !== "";
  if (!has) {
    // Products below 0.5% ABV are outside the Part 16 definition of "alcoholic beverage" and are
    // exempt (27 CFR 16.10) — an absent warning there is not a violation. Only treat it as exempt
    // when we actually have a numeric ABV proving sub-0.5%; an unknown ABV stays conservatively required.
    const abv = abvFromText(e);
    if (typeof abv === "number" && !isWarningRequired(abv)) {
      return {
        ...base(spec),
        status: "unverifiable",
        detail: "Not required below 0.5% ABV (27 CFR 16.10); none found.",
      };
    }
    return { ...base(spec), status: "missing", detail: "Government warning not found on the label." };
  }
  // The body must be the VERBATIM statutory text (27 CFR 16.21). A paraphrased, truncated, or reworded
  // warning is malformed even if its prefix is correctly all-caps + bold — mirror compareWarning so the
  // no-application completeness headline and the confirm-to-approve path enforce the same wording the
  // claimed-comparison path does (case is folded here; the prefix CAPITALS are judged by the flag below).
  if (normalizeWarning(w) !== normalizeWarning(CANONICAL_GOVERNMENT_WARNING)) {
    return {
      ...base(spec),
      status: "malformed",
      value: w,
      detail: "The warning text does not match the canonical statutory wording verbatim (27 CFR 16.21).",
    };
  }
  // A CONFIDENT title/mixed-case prefix is a hard fail; "cannot tell" (null) is surfaced for a human
  // (mirrors the bold flag) rather than failed on absence of evidence.
  if (e.warningPrefixIsAllCaps === false) {
    return {
      ...base(spec),
      status: "malformed",
      value: w,
      detail: 'The "GOVERNMENT WARNING:" prefix must be in ALL CAPITAL LETTERS (27 CFR 16.22(a)(2)).',
    };
  }
  // Bold is a real CFR requirement (16.22(a)(2)) and a documented agent rejection criterion. A
  // CONFIDENTLY not-bold prefix (false) is a hard fail — consistent with the comparator (compareWarning)
  // and the "minimize false approvals" philosophy. UNDETECTABLE bold (null) is not asserted either way;
  // we surface it for human confirmation rather than failing on absence of evidence.
  if (e.warningPrefixIsBold === false) {
    return {
      ...base(spec),
      status: "malformed",
      value: w,
      detail: 'The "GOVERNMENT WARNING:" prefix must be in BOLD type (27 CFR 16.22(a)(2)).',
    };
  }
  const capsNote =
    e.warningPrefixIsAllCaps === null
      ? " The ALL-CAPS prefix could not be verified from the image — confirm it (27 CFR 16.22(a)(2))."
      : "";
  const boldNote =
    e.warningPrefixIsBold === null
      ? " Bold type could not be verified from the image — confirm the prefix is bold (27 CFR 16.22(a)(2))."
      : "";
  const prefixDesc = e.warningPrefixIsAllCaps === true ? "an ALL-CAPS prefix" : "the required warning text";
  return { ...base(spec), status: "present", value: w, detail: `Present with ${prefixDesc}.${capsNote}${boldNote}` };
}

function base(spec: RequirementSpec): Pick<CompletenessElement, "key" | "label" | "necessity"> {
  return { key: spec.key, label: spec.label, necessity: spec.necessity };
}

/**
 * Resolve a MISSING (absent-value) alcohol-content element, where the CFR is class-specific:
 *  - wine <= 14% (and cider, which resolves to it): a "table wine"/"light wine" designation may
 *    stand in for a numeric ABV (27 CFR 4.36(a)); without it, a <= 14% wine omitting ABV is missing.
 *  - malt beverages: ABV is optional by default (27 CFR 7.63(a)(3)/7.65(a)) — neutral when absent.
 *  - spirits, wine > 14%, unknown: a numeric statement is mandatory — missing.
 * (The PRESENT case is handled inline by the generic loop, including low-confidence -> review.)
 */
export function evaluateAbsentAlcohol(spec: RequirementSpec, e: ExtractedFields, cls: BeverageClass): CompletenessElement {
  if (cls === "wineUnder14" || cls === "cider") {
    if (TABLE_WINE_DESIGNATION.test(e.classType ?? "")) {
      return {
        ...base(spec),
        status: "present",
        detail: 'Numeric ABV omitted, but a "table/light wine" designation stands in for it (27 CFR 4.36(a)).',
      };
    }
    return {
      ...base(spec),
      status: "missing",
      detail: 'Wine <= 14% ABV must state alcohol content unless labeled "table wine"/"light wine" (27 CFR 4.36(a)).',
    };
  }
  if (cls === "maltBeverage") {
    return { ...base(spec), status: "unverifiable", detail: spec.note };
  }
  return { ...base(spec), status: "missing", detail: "Alcohol content statement required but not found on the label." };
}

/**
 * Resolve an ABSENT statement of composition. It is mandatory only for SPECIALTY products (those with
 * no standard of identity), which the label signals with a distinctive/fanciful name. So: a fanciful
 * name present with NO statement of composition is the specialty-missing-its-designation case -> flag
 * it (`missing`); otherwise (a standard product) it is not required -> neutral (`unverifiable`). We key
 * off the fanciful name because "specialty" can't be proven from the image alone — the reviewer confirms.
 */
export function evaluateAbsentStatementOfComposition(spec: RequirementSpec, e: ExtractedFields): CompletenessElement {
  const fanciful = e.fancifulName;
  if (typeof fanciful === "string" && fanciful.trim() !== "") {
    return {
      ...base(spec),
      status: "missing",
      detail:
        `A distinctive/fanciful name ("${fanciful}") is present but no statement of composition was found. ` +
        "A specialty product (no standard of identity) must carry one (27 CFR 5.156; malt 7.141/7.147). " +
        "Confirm whether this is a specialty.",
    };
  }
  return { ...base(spec), status: "unverifiable", detail: spec.note };
}

/**
 * Evaluate every required element for the label's beverage class. The class is taken from the
 * extracted `beverageClass`, falling back to resolving it from the class/type text.
 */
export function checkCompleteness(extracted: ExtractedFields): CompletenessResult {
  // Resolve the class from the specific designation, falling back to the broad `class` category.
  const classText = extracted.classType?.trim() ? extracted.classType : extracted.class;
  const beverageClass: BeverageClass = resolveBeverageClass(classText, abvFromText(extracted));

  let lowConfidencePresent = false;
  const elements = mandatoryElementsFor(beverageClass).map((spec): CompletenessElement => {
    if (spec.key === "governmentWarning") return evaluateWarningElement(spec, extracted);

    const { value, confidence } = fieldFor(spec.key, extracted);
    const hasValue = typeof value === "string" && value.trim() !== "";
    if (hasValue) {
      // A present alcohol statement must be internally valid (proof = 2×ABV; malt low/reduced cap),
      // even with no application value to compare against — otherwise an impossible label reads "complete".
      if (spec.key === "alcoholContent") {
        const problem = checkAlcoholInternalConsistency(extracted.alcoholContentText, classText, beverageClass);
        if (problem) return { ...base(spec), status: "malformed", value, detail: problem };
      }
      // Net contents must be a valid quantity in the class-mandated unit system AND (spirits/wine) an
      // authorized standard of fill — presence alone is not compliance (27 CFR 5.203/5.71, 4.72/4.73, 7.70).
      if (spec.key === "netContents") {
        const problem = validateNetContents(value, beverageClass);
        if (problem) return { ...base(spec), status: "malformed", value, detail: problem };
      }
      const lowConf = confidence === undefined || confidence < FIELD_REVIEW_CONFIDENCE;
      if (lowConf) lowConfidencePresent = true;
      return {
        ...base(spec),
        status: "present",
        value,
        lowConfidence: lowConf,
        detail: lowConf ? `Found (low confidence, verify): "${value}"` : `Found: "${value}"`,
      };
    }
    // Absent value. Alcohol content is class-specific (table-wine substitution; malt optional).
    if (spec.key === "alcoholContent") {
      return evaluateAbsentAlcohol(spec, extracted, beverageClass);
    }
    // Statement of composition is required only for specialties (signaled by a fanciful name).
    if (spec.key === "statementOfComposition") {
      return evaluateAbsentStatementOfComposition(spec, extracted);
    }
    if (spec.necessity === "mandatory") {
      return { ...base(spec), status: "missing", detail: "Required but not found on the label." };
    }
    return { ...base(spec), status: "unverifiable", detail: spec.note };
  });

  // Any element resolved to missing or malformed => incomplete (an element is only marked "missing"
  // once we've decided it is genuinely required-and-absent; a conditionally-absent element is
  // "unverifiable" and neutral). A merely uncertain READ (low confidence on something we did find)
  // => review.
  const hardIssue = elements.some((el) => el.status === "missing" || el.status === "malformed");
  const overall: CompletenessOverall = hardIssue
    ? "incomplete"
    : lowConfidencePresent
      ? "review"
      : "complete";

  return { beverageClass, elements, overall };
}

/** A reviewer's per-element decision over the AI's read: "ok" confirms it correct, "issue" flags a
 *  real problem. Mirrored from the comparison cards (a person resolves a flag once, on one screen). */
export type ReviewOverride = "ok" | "issue";

/**
 * The completeness overall AFTER the reviewer's per-element overrides — the SINGLE source of truth the
 * headline gate (VerifyForm) and the supporting view (CompletenessView) BOTH read, so the two can never
 * drift. A confirmed ("ok") element counts as resolved (no longer missing/malformed); a flagged ("issue")
 * element is a hard issue. With no overrides it returns the pure check's own `overall`, leaving the
 * deterministic result (and its tests) untouched. This is what lets confirming the flagged field turn
 * an "incomplete"-gated verdict green instead of leaving it stuck on "Needs review".
 */
export function resolveCompletenessOverall(
  completeness: CompletenessResult,
  overrides?: Partial<Record<RequirementKey, ReviewOverride>>,
): CompletenessOverall {
  if (overrides == null || Object.keys(overrides).length === 0) return completeness.overall;
  const effective = (el: CompletenessElement): ElementStatus | "confirmed" | "flagged" => {
    const o = overrides[el.key];
    return o === "ok" ? "confirmed" : o === "issue" ? "flagged" : el.status;
  };
  if (
    completeness.elements.some((el) => {
      const d = effective(el);
      return d === "missing" || d === "malformed" || d === "flagged";
    })
  ) {
    return "incomplete";
  }
  if (completeness.elements.some((el) => effective(el) === "present" && el.lowConfidence)) {
    return "review";
  }
  return "complete";
}
