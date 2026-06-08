/**
 * compare/verify.ts — orchestrates the three field checks into one label verdict.
 *
 * Pure and deterministic: given the claimed application values and the extracted label fields,
 * run compareBrand / compareAlcohol / compareWarning and reduce to an overall verdict. Reused by
 * the /api/verify route and the eval harness. The confidence gate is
 * layered on top of this value-based result, not baked in here.
 */
import { isWarningRequired, type ClaimedFields, type ExtractedFields } from "@/domain";
import type { FieldResult, FieldStatus } from "./types";
import { compareBrand, compareAlcohol, compareWarning } from "./comparators";
import { parseAlcoholText } from "./alcohol";
import { applyConfidenceGate } from "./thresholds";

/** Overall label verdict. Asymmetric reduction biases away from false approval. */
export type OverallVerdict = "approve" | "review" | "reject";

/** Per-field results plus the reduced overall verdict. */
export interface VerifyResult {
  brand: FieldResult;
  alcohol: FieldResult;
  warning: FieldResult;
  overall: OverallVerdict;
}

/**
 * Reduce per-field statuses to an overall verdict:
 *   reject if ANY field fails; else review if ANY field needs review; else approve.
 * (Matches eval/fixtures/cases.json `_verdictModel`.)
 */
export function overallVerdict(statuses: readonly FieldStatus[]): OverallVerdict {
  if (statuses.includes("fail")) return "reject";
  if (statuses.includes("review")) return "review";
  return "approve";
}

/** Run all three checks and reduce to an overall verdict. */
export function verifyLabel(
  claimed: ClaimedFields,
  extracted: ExtractedFields,
): VerifyResult {
  // Value-based verdicts, then the asymmetric confidence gate: a pass/fail below the field-review
  // threshold is downgraded to `review` (this is how the reconciler's disagreement-confidence and
  // any low-confidence read become a `review` verdict — never an asserted approval).
  const brand = applyConfidenceGate(
    compareBrand({ claimed: claimed.brand, extracted: extracted.brand }),
    extracted.confidence.brand,
  );

  const alcohol = applyConfidenceGate(
    compareAlcohol({
      claimedText: claimed.alcoholContentText,
      extractedText: extracted.alcoholContentText,
      claimedClass: claimed.classType,
      extractedClass: extracted.classType,
      beverageClass: claimed.beverageClass,
    }),
    extracted.confidence.alcoholContent,
  );

  // The government-warning <0.5% exemption (27 CFR 16.10) is granted ONLY when BOTH the application's
  // claimed ABV AND the label's own (extracted) ABV prove sub-0.5% — so a mis-stated/understated
  // application value can't wave away a genuinely-missing statutory warning (matches completeness.ts).
  const claimedAbv = parseAlcoholText(claimed.alcoholContentText).abv ?? claimed.alcoholContent?.abv;
  const extractedAbv = parseAlcoholText(extracted.alcoholContentText).abv;
  const warningExempt =
    claimedAbv !== undefined &&
    !isWarningRequired(claimedAbv) &&
    extractedAbv !== undefined &&
    !isWarningRequired(extractedAbv);
  const warningResult = compareWarning({
    warningText: extracted.warningText,
    warningPrefixIsAllCaps: extracted.warningPrefixIsAllCaps,
    warningPrefixIsBold: extracted.warningPrefixIsBold,
    // Only pass an exempting ABV when BOTH agree it's sub-0.5%; otherwise evaluate the warning normally.
    abv: warningExempt ? claimedAbv : undefined,
  });
  // When exempt the verdict rests on the ABV, not the extracted warning read, so it is not gated.
  const warning = warningExempt
    ? warningResult
    : applyConfidenceGate(warningResult, extracted.confidence.warningText);

  const overall = overallVerdict([brand.status, alcohol.status, warning.status]);
  return { brand, alcohol, warning, overall };
}
