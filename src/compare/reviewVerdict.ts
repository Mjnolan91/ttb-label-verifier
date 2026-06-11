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
import type { BeverageClass, ClaimedFields, ExtractedFields, RequirementKey } from "@/domain";
import { verifyLabel, type VerifyResult, type OverallVerdict } from "./verify";
import { checkCompleteness, type CompletenessResult, type CompletenessOverall } from "./completeness";
import { requiredInputKeysFor } from "./requiredInputs";
import { parseAlcoholText, resolveBeverageClass } from "./alcohol";

const RANK: Record<OverallVerdict, number> = { approve: 0, review: 1, reject: 2 };

/** The outcome of the batch "enough to compare?" gate. */
export interface ClaimedGate {
  /** ClaimedFields when the gate passes; null when a required input is missing. */
  claimed: ClaimedFields | null;
  /** The gate inputs still missing — only ever `brand` and/or `alcoholContent`. */
  missing: RequirementKey[];
  /** The beverage class the alcohol-required decision was resolved from. */
  beverageClass: BeverageClass;
}

/**
 * The BATCH screen's "enough to compare?" gate: build ClaimedFields from a loose application row, or
 * report what's missing. Brand is required for every class (the one universally mandatory input);
 * alcohol content is required ONLY where the law mandates it for the resolved beverage class
 * (spirits / wine >14% / unknown — same `requiredInputKeysFor` matrix the single screen gates on), so
 * a legal malt or table-wine application without an ABV still gets a verdict. The class resolves from
 * the CLAIMED class/type first, else the label's reading; the wine ≤14/>14 split from the claimed ABV,
 * else the label's. Other absent fields are simply not compared (or compared to `review`, never
 * approved) — batch can't prompt interactively, so gaps route to the human worklist instead of
 * blocking the row. (The single screen, which CAN prompt, blocks until its full per-type required
 * input set is typed — a deliberate difference in gate, same underlying matrix.)
 */
export function toClaimedFields(
  input: {
    brand?: string;
    alcoholContentText?: string;
    classType?: string;
    netContents?: string;
    name?: string;
    address?: string;
    countryOfOrigin?: string;
    fancifulName?: string;
    statementOfComposition?: string;
  },
  extracted: ExtractedFields,
): ClaimedGate {
  const classText = input.classType?.trim()
    ? input.classType
    : extracted.classType?.trim()
      ? extracted.classType
      : extracted.class;
  const abv = parseAlcoholText(input.alcoholContentText).abv ?? parseAlcoholText(extracted.alcoholContentText).abv;
  const beverageClass = resolveBeverageClass(classText, abv);

  const missing: RequirementKey[] = [];
  if (!(input.brand ?? "").trim()) missing.push("brand");
  if (requiredInputKeysFor(beverageClass).includes("alcoholContent") && !(input.alcoholContentText ?? "").trim()) {
    missing.push("alcoholContent");
  }
  if (missing.length > 0) return { claimed: null, missing, beverageClass };

  const opt = (v?: string): string | undefined => (v?.trim() ? v.trim() : undefined);
  return {
    claimed: {
      brand: (input.brand ?? "").trim(),
      alcoholContentText: opt(input.alcoholContentText),
      classType: opt(input.classType),
      netContents: opt(input.netContents),
      name: opt(input.name),
      address: opt(input.address),
      countryOfOrigin: opt(input.countryOfOrigin),
      fancifulName: opt(input.fancifulName),
      statementOfComposition: opt(input.statementOfComposition),
    },
    missing: [],
    beverageClass,
  };
}

/** The worse (more conservative) of two verdicts. */
export function worstVerdict(a: OverallVerdict, b: OverallVerdict): OverallVerdict {
  return RANK[a] >= RANK[b] ? a : b;
}

/** How a completeness outcome constrains the overall verdict. `incomplete` (a missing/malformed
 *  mandatory element) blocks approval -> `review`; `review` (a mandatory element present only at
 *  LOW read confidence) blocks it too — an element the read can't vouch for must not be approved
 *  just because the application didn't happen to claim it. Exported as THE one mapping so
 *  deriveLabelReview's override-aware gate can never be more lenient than this combine. */
export const COMPLETENESS_VERDICT: Record<CompletenessOverall, OverallVerdict> = {
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

  // Safety net: callers pre-validate before passing a non-null `claimed`. The single screen now gates
  // on the FULL per-type required-input set (requiredInputKeysFor) before getting here, and alcohol is
  // NOT mandatory for every class (wine ≤14% table-wine substitution; malt-optional; cider), so the net
  // requires only BRAND — the one input mandatory for every beverage type. verifyLabel still compares an
  // absent alcohol to `review` (never approves it), so a missing-but-not-required alcohol can't be
  // silently approved.
  const hasClaimed = claimed != null && (claimed.brand ?? "").trim() !== "";
  if (!hasClaimed) {
    return { overall: null, verify: null, completeness, gatedByCompleteness: false };
  }

  const verify = verifyLabel(claimed, extracted);
  const overall = worstVerdict(verify.overall, completenessVerdict);
  return { overall, verify, completeness, gatedByCompleteness: overall !== verify.overall };
}
