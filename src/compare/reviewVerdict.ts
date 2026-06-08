// src/compare/reviewVerdict.ts
/**
 * compare/reviewVerdict.ts — combine the claimed-vs-label comparison with the per-type TTB
 * completeness check into ONE headline verdict. This realizes "you can't approve a label that is
 * missing a field TTB requires for its beverage type": even when brand / alcohol / government
 * warning all pass, an incomplete label is no longer Approved.
 *
 * Pure and deterministic (no I/O, no model). A missing/malformed MANDATORY element maps to `review`
 * — it blocks approval, but does not auto-reject, because the extractor may have misread a present
 * field (asymmetric: never auto-approve an incomplete label, never auto-reject on a possible miss).
 * The government warning keeps its hard-fail-on-missing via verifyLabel's strict check. A later plan
 * adds the human confirm-to-approve step that escalates a confirmed-missing element to `reject`.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import { verifyLabel, type VerifyResult, type OverallVerdict } from "./verify";
import { checkCompleteness, type CompletenessResult, type CompletenessOverall } from "./completeness";

const RANK: Record<OverallVerdict, number> = { approve: 0, review: 1, reject: 2 };

/** The worse (more conservative) of two verdicts. */
export function worstVerdict(a: OverallVerdict, b: OverallVerdict): OverallVerdict {
  return RANK[a] >= RANK[b] ? a : b;
}

/** How a completeness outcome constrains the overall verdict. `incomplete` (a missing/malformed
 *  mandatory element) blocks approval -> `review`; the confirm-to-approve plan later escalates a
 *  human-confirmed missing element to `reject`. */
const COMPLETENESS_VERDICT: Record<CompletenessOverall, OverallVerdict> = {
  complete: "approve",
  review: "review",
  incomplete: "review",
};

export interface CombinedVerdict {
  /** Headline verdict, or null when no application values were supplied (completeness is the headline). */
  overall: OverallVerdict | null;
  /** The claimed-vs-label comparison (null when no application values supplied). */
  verify: VerifyResult | null;
  /** The per-type completeness check. */
  completeness: CompletenessResult;
  /** True when the 3 checks alone would have been more lenient but completeness made the verdict worse. */
  gatedByCompleteness: boolean;
}

/**
 * Combine the comparison + completeness into one verdict.
 * @param claimed application values, or null when none supplied (then `overall` is null and the
 *               completeness summary is the headline, matching today's no-application behavior).
 * @param extracted the merged label reading.
 */
export function combinedVerdict(
  claimed: ClaimedFields | null,
  extracted: ExtractedFields,
): CombinedVerdict {
  const completeness = checkCompleteness(extracted);
  const completenessVerdict = COMPLETENESS_VERDICT[completeness.overall];

  const hasClaimed =
    claimed != null &&
    (claimed.brand ?? "").trim() !== "" &&
    (claimed.alcoholContentText ?? "").trim() !== "";
  if (!hasClaimed) {
    return { overall: null, verify: null, completeness, gatedByCompleteness: false };
  }

  const verify = verifyLabel(claimed, extracted);
  const overall = worstVerdict(verify.overall, completenessVerdict);
  return { overall, verify, completeness, gatedByCompleteness: overall !== verify.overall };
}
