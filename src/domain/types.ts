/**
 * types.ts — Shared domain types for claimed and extracted label fields.
 *
 * CFR-VERIFIED MODULE (see ./README.md). These types model the three TTB checks the
 * prototype performs (brand, alcohol content, government warning) plus supporting fields.
 *
 * Design rule from the architecture ("AI extracts, code compares"):
 *   - ClaimedFields = what the APPLICATION asserts. No confidence — a human typed it.
 *   - ExtractedFields = what a VisionProvider read OFF THE IMAGE. Probabilistic, so every
 *     field carries a per-field confidence and the raw values may be absent/garbled.
 *   The deterministic comparator consumes both and emits pass/review/fail.
 */

/**
 * The beverage class. This is an INPUT to the alcohol-content check, not a passive label:
 * the class SELECTS which CFR tolerance rule applies (see tolerances.ts) and whether the
 * government warning is even required. Treat it as load-bearing.
 *
 *   - distilledSpirits — 27 CFR Part 5  (tolerance +/-0.3 pp, 27 CFR 5.65(c)).
 *   - wineUnder14      — wine <=14% ABV, 27 CFR Part 4 (tolerance +/-1.5 pp, 4.36(b)(1)).
 *   - wineOver14       — wine  >14% ABV, 27 CFR Part 4 (tolerance +/-1.0 pp, 4.36(b)(1)).
 *   - maltBeverage     — beer / malt beverages, 27 CFR Part 7 (tolerance +/-0.3 pp, 7.65).
 *   - cider            — hard cider. Has NO standalone tolerance: it RESOLVES to wine
 *                        (most common: apple/pear fruit cider, Part 4, +/-1.5 pp) or to
 *                        malt beverage (brewed from malted barley, Part 7, +/-0.3 pp)
 *                        depending on production method. See tolerances.ts for how this is
 *                        mapped; the default resolution here is wine (<=14%).
 *   - unknown          — class not supplied / not determinable. The comparator should fall
 *                        back to the most conservative behavior rather than guessing.
 */
export type BeverageClass =
  | "distilledSpirits"
  | "wineUnder14"
  | "wineOver14"
  | "maltBeverage"
  | "cider"
  | "unknown";

/**
 * Alcohol content as it appears on a label or in an application. ABV is the primary,
 * canonical value; proof is optional and, when present, must satisfy proof = 2 x ABV
 * (the comparator cross-checks this — see alcohol.ts: proofToAbv / abvToProof).
 *
 * Values are percentage points and proof degrees respectively (e.g. abv: 40, proof: 80).
 */
export interface AlcoholContent {
  /** Alcohol by volume, in percentage points (e.g. 13.5 means 13.5% ABV). */
  abv: number;
  /** Optional proof (US): proof = 2 x ABV. Present when the label states it. */
  proof?: number;
}

/**
 * Per-field confidence scores for an extraction, in [0, 1] (1 = fully confident).
 * Confidence belongs on ExtractedFields ONLY — claimed values are human-entered and so
 * are not probabilistic. The comparator/reconciler use these to route low-confidence
 * fields to `review` rather than asserting a verdict.
 *
 * Every key is optional: a provider may not return a value for a field it could not read,
 * in which case it should also omit (or zero) the corresponding confidence.
 */
export interface FieldConfidence {
  brand?: number;
  classType?: number;
  alcoholContent?: number;
  netContents?: number;
  warningText?: number;
  /** Confidence that the prefix all-caps determination is correct. */
  warningPrefixIsAllCaps?: number;
  /** Confidence that the prefix bold determination is correct. */
  warningPrefixIsBold?: number;
  // Extended TTB label elements (see ExtractedFields + labelRequirements.ts).
  class?: number;
  name?: number;
  address?: number;
  countryOfOrigin?: number;
  appellation?: number;
  vintage?: number;
  varietal?: number;
  sulfiteDeclaration?: number;
  ageStatement?: number;
  commodityStatement?: number;
}

/**
 * What the application CLAIMS for a label. Source of truth for the comparison: every
 * extracted value is judged against these. No confidence here by design — a human entered
 * these values, so they are treated as asserted fact, not probabilistic observation.
 */
export interface ClaimedFields {
  /** Claimed brand name, e.g. "Stone's Throw". Compared fuzzily (case/punctuation-insensitive). */
  brand: string;
  /**
   * Free-text class/type designation as written on the application, e.g. "Bourbon Whiskey",
   * "Table Wine", "India Pale Ale". Distinct from `beverageClass`, which is the normalized
   * enum that selects the tolerance rule.
   */
  classType?: string;
  /**
   * Normalized beverage class. This is an INPUT that selects the alcohol tolerance rule and
   * gates the warning requirement; supply it whenever known. Defaults conceptually to
   * "unknown" when the application does not specify it.
   */
  beverageClass?: BeverageClass;
  /** Claimed alcohol content (ABV, optional proof). May be absent if the application omits it. */
  alcoholContent?: AlcoholContent;
  /**
   * Raw, as-written claimed alcohol statement, e.g. "45% Alc./Vol. (90 Proof)". Mirrors
   * ExtractedFields.alcoholContentText so the comparator parses claimed and extracted from the
   * SAME free-text form the application/label actually carry (claimed vs extracted, symmetric).
   */
  alcoholContentText?: string;
  /** Claimed net contents, e.g. "750 mL". Compared (when supplied) against the label's net contents. */
  netContents?: string;
  /** Claimed producer/bottler name, e.g. "ABC Distillery". Compared fuzzily when supplied. */
  name?: string;
  /** Claimed producer/bottler address, e.g. "Frederick, MD". Compared fuzzily when supplied. */
  address?: string;
  /** Claimed country of origin (imports), e.g. "Scotland". Compared when supplied. */
  countryOfOrigin?: string;
  /**
   * Claimed/expected government warning text. Usually the canonical statutory text; present
   * so the comparator can be driven by claimed-vs-extracted symmetrically, though warning
   * comparison is ultimately against the canonical constant in warning.ts.
   */
  warningText?: string;
}

/**
 * What a VisionProvider EXTRACTED from the image. Probabilistic: any field may be missing
 * or wrong, and `confidence` reports the provider's per-field certainty. The comparator
 * combines low confidence with the deterministic rules to decide pass / review / fail.
 */
export interface ExtractedFields {
  /** Brand name read off the label, or undefined if not found. */
  brand?: string;
  /** Broad class / category, e.g. "Whisky", "Wine", "Malt beverage". Distinct from the type. */
  class?: string;
  /** Specific class/type DESIGNATION (standard of identity), e.g. "Straight Rye Whisky". */
  classType?: string;
  /**
   * Raw, AS-WRITTEN alcohol statement read off the label, e.g. "45% Alc./Vol. (90 Proof)" or
   * "45% Alc./Vol." (proof absent). Extraction stays raw/probabilistic: providers populate this
   * single text field and leave parsing/interpretation to the deterministic comparator/completeness
   * checker, which PARSE it into ABV + proof (via parseAlcoholText) and cross-check proof = 2 x ABV
   * ("AI extracts, code compares"). There is deliberately no pre-parsed structured form here — a
   * single text source avoids the text-vs-struct drift across the front/back merge.
   */
  alcoholContentText?: string;
  /** Net contents read off the label, e.g. "750 mL". */
  netContents?: string;
  /** The full government-warning text read off the label, verbatim as extracted. */
  warningText?: string;
  /**
   * Whether the "GOVERNMENT WARNING:" prefix was rendered in ALL CAPITAL LETTERS, per
   * 27 CFR 16.22(a)(2). Tri-state (mirrors warningPrefixIsBold):
   *   - true  = clearly all-caps as required.
   *   - false = clearly NOT all-caps (e.g. title-case "Government Warning") — a real violation.
   *   - null  = cannot tell from the image; surfaced for human confirmation, never hard-failed.
   */
  warningPrefixIsAllCaps: boolean | null;
  /**
   * Whether the "GOVERNMENT WARNING:" prefix was rendered in BOLD TYPE, per 27 CFR
   * 16.22(a)(2). Tri-state on purpose:
   *   - true  = detected bold.
   *   - false = detected NOT bold.
   *   - null  = boldness is UNDETECTABLE for this extractor/image (e.g. OCR with no type
   *             metadata). The comparator must treat null as "cannot assert", not as a
   *             violation — absence of evidence is not evidence of a violation.
   */
  warningPrefixIsBold: boolean | null;
  /**
   * Responsible-party NAME as printed, e.g. "ABC Distillery" (from "DISTILLED & BOTTLED BY: ABC
   * DISTILLERY"). The bottling/producing verb belongs with the commodity statement, not the name.
   */
  name?: string;
  /** Responsible-party ADDRESS as printed, e.g. "Frederick, MD". Separate from the name. */
  address?: string;
  /** Country of origin, required for imported products, e.g. "Product of Scotland". */
  countryOfOrigin?: string;
  /** Appellation of origin (wine), e.g. "Napa Valley". */
  appellation?: string;
  /** Vintage year (wine), e.g. "2019". */
  vintage?: string;
  /** Grape varietal (wine), e.g. "Cabernet Sauvignon". */
  varietal?: string;
  /** Sulfite declaration (wine), e.g. "Contains Sulfites". "" at high confidence = none present. */
  sulfiteDeclaration?: string;
  /** Age statement (distilled spirits), e.g. "Aged 4 Years". */
  ageStatement?: string;
  /** Commodity statement (distilled spirits) when distinct from name/address. */
  commodityStatement?: string;
  /** Per-field confidence scores in [0, 1]. */
  confidence: FieldConfidence;
}
