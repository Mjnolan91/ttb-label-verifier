/**
 * compare/verify.ts — orchestrates the three field checks into one label verdict.
 *
 * Pure and deterministic: given the claimed application values and the extracted label fields,
 * run compareBrand / compareAlcohol / compareWarning and reduce to an overall verdict. Reused by
 * the /api/verify route (US-005) and the eval harness (US-012). The confidence gate (US-011) is
 * layered on top of this value-based result, not baked in here.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import type { FieldResult, FieldStatus } from "./types";
import { compareBrand, compareAlcohol, compareWarning } from "./comparators";
import { parseAlcoholText } from "./alcohol";

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
  const brand = compareBrand({ claimed: claimed.brand, extracted: extracted.brand });

  const alcohol = compareAlcohol({
    claimedText: claimed.alcoholContentText,
    extractedText: extracted.alcoholContentText,
    claimedClass: claimed.classType,
    beverageClass: claimed.beverageClass,
  });

  // The warning exemption (<0.5% ABV) keys off the claimed ABV (free text first, then structured).
  const claimedAbv =
    parseAlcoholText(claimed.alcoholContentText).abv ?? claimed.alcoholContent?.abv;
  const warning = compareWarning({
    warningText: extracted.warningText,
    warningPrefixIsAllCaps: extracted.warningPrefixIsAllCaps,
    warningPrefixIsBold: extracted.warningPrefixIsBold,
    abv: claimedAbv,
  });

  const overall = overallVerdict([brand.status, alcohol.status, warning.status]);
  return { brand, alcohol, warning, overall };
}
