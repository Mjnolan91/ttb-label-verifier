/**
 * productVerdict.ts — the ONE derivation of a batch product's application values and verdict, shared
 * by the row badges/triage (derivedOf), the review drawer, and both exports. The application a row is
 * verified against = the matched CSV row OVERLAID with the reviewer's drawer edits (an explicit ""
 * clears a wrong CSV value), so editing in the drawer, the list, and the exports can never disagree.
 * Pure and deterministic — the same toClaimedFields gate + combinedVerdict the CSV path always used.
 */
import type { ExtractedFields } from "@/domain";
import type { ClaimedRow } from "@/batch/csv";
import { combinedVerdict, toClaimedFields, type CombinedVerdict } from "@/compare";
import type { AppInputKey } from "../ui/fieldHelpCopy";
import type { ApplicationEdits } from "./useWorklist";

/** A product's application values keyed by input (the drawer's working shape). */
export type ApplicationValues = Partial<Record<AppInputKey, string>>;

/** The CSV row's values keyed by input (note: the CSV calls alcohol `alcoholContent` too). */
export function applicationFromCsv(row: ClaimedRow | null | undefined): ApplicationValues {
  if (!row) return {};
  return {
    brand: row.brand,
    classType: row.classType,
    alcoholContent: row.alcoholContent,
    netContents: row.netContents,
    name: row.name,
    address: row.address,
    countryOfOrigin: row.countryOfOrigin,
    fancifulName: row.fancifulName,
    statementOfComposition: row.statementOfComposition,
  };
}

/** CSV row + reviewer edits -> the effective application (edits win; "" clears). Null when every
 *  value is blank — "no application supplied", the completeness-only review path. */
export function mergeApplication(
  row: ClaimedRow | null | undefined,
  edits?: ApplicationEdits,
): ApplicationValues | null {
  const merged: ApplicationValues = { ...applicationFromCsv(row) };
  for (const [k, v] of Object.entries(edits ?? {}) as [AppInputKey, string][]) merged[k] = v;
  const hasAny = Object.values(merged).some((v) => (v ?? "").trim() !== "");
  return hasAny ? merged : null;
}

export interface ProductVerdict {
  /** The combined verdict (comparison + completeness), or null when the label wasn't readable. */
  combined: CombinedVerdict | null;
  /** Application values exist but the gate needs more — the human-readable list of what to add. */
  claimedNeeds?: string;
  /** The effective application the verdict used (null when none supplied; the exports' audit trail). */
  application: ApplicationValues | null;
}

const NEED_PHRASE: Partial<Record<string, string>> = { brand: "a brand", alcoholContent: "alcohol content" };

/**
 * Gate + verdict for one product. Mirrors the original analyze-time logic exactly: the batch
 * "enough to compare?" gate is toClaimedFields (brand always, alcohol only where the law requires it
 * for the resolved class — deliberately NOT the single screen's stricter full-required-set gate, so
 * existing CSV rows keep their verdicts), and every readable product gets a combined verdict
 * (completeness-only when no application values exist) so it is always reviewable.
 */
export function deriveProductVerdict(
  application: ApplicationValues | null,
  extracted: ExtractedFields | undefined,
  readable: boolean,
): ProductVerdict {
  if (!extracted) return { combined: null, application };
  const gate = application
    ? toClaimedFields(
        {
          brand: application.brand,
          alcoholContentText: application.alcoholContent,
          classType: application.classType,
          netContents: application.netContents,
          name: application.name,
          address: application.address,
          countryOfOrigin: application.countryOfOrigin,
          fancifulName: application.fancifulName,
          statementOfComposition: application.statementOfComposition,
        },
        extracted,
      )
    : null;
  const needs = (gate?.missing ?? []).map((k) => NEED_PHRASE[k] ?? k).join(" + ");
  const combined = readable ? combinedVerdict(gate?.claimed ?? null, extracted) : null;
  return {
    combined,
    claimedNeeds: application && !gate?.claimed ? needs : undefined,
    application,
  };
}
