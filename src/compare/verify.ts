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
import {
  compareBrand,
  compareAlcohol,
  compareWarning,
  compareClassType,
  compareNetContents,
  compareName,
  compareAddress,
  compareOrigin,
  compareFancifulName,
  compareStatementOfComposition,
} from "./comparators";
import { parseAlcoholText } from "./alcohol";
import { applyConfidenceGate } from "./thresholds";

/** Overall label verdict. Asymmetric reduction biases away from false approval. */
export type OverallVerdict = "approve" | "review" | "reject";

/** Stable identity for each comparison, so the UI and CSV can iterate the field list generically. */
export type VerifyFieldKey =
  | "brand"
  | "classType"
  | "alcohol"
  | "netContents"
  | "name"
  | "address"
  | "countryOfOrigin"
  | "fancifulName"
  | "statementOfComposition"
  | "warning";

/** One field comparison with its identity + label, for uniform rendering/iteration. */
export interface VerifyField extends FieldResult {
  key: VerifyFieldKey;
  label: string;
}

/**
 * The full label-vs-application comparison. `fields` is the ordered, present-only list of every
 * comparison that RAN (a field the application didn't supply is omitted) — the uniform render/iterate
 * surface. `brand`/`alcohol`/`warning` are convenience accessors (the SAME verdicts as in `fields`)
 * to avoid churn in eval/CSV; they are always present because brand is gated everywhere, the warning
 * is auto-compared, and the alcohol comparison always runs (an UNSUPPLIED claimed alcohol — legal for
 * malt / wine ≤14% / cider — compares to `review`, never approve).
 */
export interface VerifyResult {
  fields: VerifyField[];
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

/**
 * Compare the label against the application, field by field. Brand, alcohol and the (auto) government
 * warning ALWAYS appear; every OTHER field appears only when the application supplied a value, so a
 * blank application field never produces a false "no match". Each value-based verdict passes through
 * the asymmetric confidence gate (a pass/fail below the field-review threshold -> `review`), then the
 * field list reduces to one overall verdict.
 */
export function verifyLabel(
  claimed: ClaimedFields,
  extracted: ExtractedFields,
): VerifyResult {
  const fields: VerifyField[] = [];
  const add = (key: VerifyFieldKey, label: string, r: FieldResult): FieldResult => {
    fields.push({ key, label, ...r });
    return r;
  };

  const brand = add(
    "brand",
    "Brand name",
    applyConfidenceGate(compareBrand({ claimed: claimed.brand, extracted: extracted.brand }), extracted.confidence.brand),
  );

  // Class/type — compared against the label's specific designation (falling back to the broad class).
  if (claimed.classType?.trim()) {
    add(
      "classType",
      "Class / type designation",
      applyConfidenceGate(
        compareClassType({
          claimed: claimed.classType,
          extracted: extracted.classType?.trim() ? extracted.classType : extracted.class,
          claimedBeverageClass: claimed.beverageClass,
        }),
        extracted.confidence.classType ?? extracted.confidence.class,
      ),
    );
  }

  const alcohol = add(
    "alcohol",
    "Alcohol content",
    applyConfidenceGate(
      compareAlcohol({
        claimedText: claimed.alcoholContentText,
        extractedText: extracted.alcoholContentText,
        claimedClass: claimed.classType,
        extractedClass: extracted.classType,
        beverageClass: claimed.beverageClass,
      }),
      extracted.confidence.alcoholContent,
    ),
  );

  if (claimed.netContents?.trim()) {
    add(
      "netContents",
      "Net contents",
      applyConfidenceGate(
        compareNetContents({ claimed: claimed.netContents, extracted: extracted.netContents }),
        extracted.confidence.netContents,
      ),
    );
  }
  if (claimed.name?.trim()) {
    add(
      "name",
      "Producer / bottler name",
      applyConfidenceGate(compareName({ claimed: claimed.name, extracted: extracted.name }), extracted.confidence.name),
    );
  }
  if (claimed.address?.trim()) {
    add(
      "address",
      "Producer / bottler address",
      applyConfidenceGate(compareAddress({ claimed: claimed.address, extracted: extracted.address }), extracted.confidence.address),
    );
  }
  if (claimed.countryOfOrigin?.trim()) {
    add(
      "countryOfOrigin",
      "Country of origin",
      applyConfidenceGate(
        compareOrigin({ claimed: claimed.countryOfOrigin, extracted: extracted.countryOfOrigin }),
        extracted.confidence.countryOfOrigin,
      ),
    );
  }
  if (claimed.fancifulName?.trim()) {
    add(
      "fancifulName",
      "Distinctive / fanciful name",
      applyConfidenceGate(
        compareFancifulName({ claimed: claimed.fancifulName, extracted: extracted.fancifulName }),
        extracted.confidence.fancifulName,
      ),
    );
  }
  if (claimed.statementOfComposition?.trim()) {
    add(
      "statementOfComposition",
      "Statement of composition",
      applyConfidenceGate(
        compareStatementOfComposition({ claimed: claimed.statementOfComposition, extracted: extracted.statementOfComposition }),
        extracted.confidence.statementOfComposition,
      ),
    );
  }

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
    warningRemainderIsBold: extracted.warningRemainderIsBold,
    warningIsReadilyLegible: extracted.warningIsReadilyLegible,
    // Only pass an exempting ABV when BOTH agree it's sub-0.5%; otherwise evaluate the warning normally.
    abv: warningExempt ? claimedAbv : undefined,
  });
  // When exempt the verdict rests on the ABV, not the extracted warning read, so it is not gated.
  const warning = add(
    "warning",
    "Government warning",
    warningExempt ? warningResult : applyConfidenceGate(warningResult, extracted.confidence.warningText),
  );

  const overall = overallVerdict(fields.map((f) => f.status));
  return { fields, brand, alcohol, warning, overall };
}
