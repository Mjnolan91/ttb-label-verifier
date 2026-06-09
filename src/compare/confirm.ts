/**
 * confirm.ts — the confirm-to-approve verdict model (Feature A Part 2).
 *
 * Pure and deterministic. Given the AI's extracted fields and the human's per-field confirmations,
 * it computes, for every element TTB requires for the resolved beverage type, a confidence-aware
 * status (pass/review/fail) plus whether the element still needs a human touch — and reduces those
 * to an overall verdict gated on confirmation. It REUSES the CFR comparators and the warning/
 * absent-alcohol classifiers (no CFR constant is duplicated). The government warning is auto-
 * evaluated (never a free-text field).
 */
import type { BeverageClass, ExtractedFields, RequirementKey } from "@/domain";
import { mandatoryElementsFor } from "@/domain";
import type { FieldStatus } from "./types";
import { overallVerdict } from "./verify";
import type { OverallVerdict } from "./verify";
import { fieldFor, evaluateWarningElement, evaluateAbsentAlcohol } from "./completeness";
import { compareBrand, compareAlcohol } from "./comparators";
import { resolveBeverageClass, parseAlcoholText } from "./alcohol";
import { FIELD_REVIEW_CONFIDENCE } from "./thresholds";
import { normalizeText } from "./text";

/** The five human-facing beverage-class choices a reviewer can pick in the confirm panel. Each value
 *  is a token resolveBeverageClass already recognizes (compare/alcohol.ts), so an override feeds the
 *  SAME resolver the AI reading uses — the wine ≤14/>14 split and the unknown fallback come for free. */
export type ClassChoice = "distilledSpirits" | "wine" | "maltBeverage" | "cider" | "unknown";

/** The human's action on a field. */
export type ConfirmState = "unconfirmed" | "accepted" | "edited" | "missing";

export interface FieldConfirmation {
  state: ConfirmState;
  /** Present only when state === "edited": the value the human entered. */
  editedValue?: string;
}

export interface ConfirmFieldResult {
  key: RequirementKey;
  label: string;
  necessity: "mandatory" | "conditional";
  /** The AI's reading of this element ("" when nothing was read). */
  aiValue: string;
  /** The value the verdict is based on (edited value when edited, else the AI value). */
  value: string;
  /** Model confidence in the AI reading, when applicable. */
  confidence?: number;
  /** Whether the human can edit/confirm this element (the warning is auto-evaluated, never editable). */
  editable: boolean;
  /** Intrinsically uncertain/blocking before any human action (low-conf / missing-mandatory / bold-undetectable). Drives hoisting. */
  flagged: boolean;
  /** Flagged AND not yet resolved by the human -> the Approve control stays blocked. */
  needsConfirmation: boolean;
  /** The human's action so far. */
  state: ConfirmState;
  /** Per-field verdict given the AI read + human action. */
  status: FieldStatus;
  /** Plain-language explanation for the card. */
  reason: string;
}

export interface ConfirmVerdict {
  beverageClass: BeverageClass;
  fields: ConfirmFieldResult[];
  /** Overall verdict given current confirmations: reject if any fail; else review if any review; else approve. */
  overall: OverallVerdict;
  /** True while any flagged field is still unconfirmed — the Approve control stays blocked. */
  awaitingConfirmation: boolean;
}

/** Compare a human EDIT (claimed) against the AI reading (extracted) using the field's comparator. */
function statusForEdit(
  key: RequirementKey,
  edited: string,
  aiValue: string,
  extracted: ExtractedFields,
  beverageClass: BeverageClass,
): { status: FieldStatus; reason: string } {
  if (key === "brand") {
    const r = compareBrand({ claimed: edited, extracted: aiValue });
    return { status: r.status, reason: r.reason };
  }
  if (key === "alcoholContent") {
    const r = compareAlcohol({
      claimedText: edited,
      extractedText: aiValue,
      claimedClass: extracted.classType,
      extractedClass: extracted.classType,
      beverageClass,
    });
    return { status: r.status, reason: r.reason };
  }
  // Generic fields (net contents, name, address, country, …): normalized equality, else review.
  if (normalizeText(edited) === normalizeText(aiValue)) {
    return { status: "pass", reason: "Your value matches what the AI read off the label." };
  }
  return {
    status: "review",
    reason: "Your value differs from what the AI read — a person should confirm which is right.",
  };
}

/** The beverage class the AI read for an extraction (no human override) — the confirm panel's default
 *  selection. Exposed so the UI can tell whether the reviewer has actually changed the class. */
export function resolveExtractedClass(extracted: ExtractedFields): BeverageClass {
  const classText = extracted.classType?.trim() ? extracted.classType : extracted.class;
  return resolveBeverageClass(classText, parseAlcoholText(extracted.alcoholContentText).abv);
}

export function confirmVerdict(
  extracted: ExtractedFields,
  confirmations: Partial<Record<RequirementKey, FieldConfirmation>> = {},
  classOverride?: ClassChoice,
): ConfirmVerdict {
  const beverageClass: BeverageClass = classOverride
    ? resolveBeverageClass(classOverride, parseAlcoholText(extracted.alcoholContentText).abv)
    : resolveExtractedClass(extracted);

  const fields: ConfirmFieldResult[] = mandatoryElementsFor(beverageClass).map((spec): ConfirmFieldResult => {
    const c = confirmations[spec.key] ?? { state: "unconfirmed" as ConfirmState };

    // ---- The government warning: auto-evaluated, not editable. ----
    if (spec.key === "governmentWarning") {
      const el = evaluateWarningElement(spec, extracted);
      const base = {
        key: spec.key, label: spec.label, necessity: spec.necessity,
        aiValue: el.value ?? "", value: el.value ?? "", confidence: extracted.confidence.warningText,
        editable: false, state: c.state,
      };
      if (el.status === "missing" || el.status === "malformed") {
        return { ...base, flagged: true, needsConfirmation: false, status: "fail", reason: el.detail };
      }
      if (el.status === "unverifiable") {
        return { ...base, flagged: false, needsConfirmation: false, status: "pass", reason: el.detail };
      }
      if (extracted.warningPrefixIsBold === null && c.state !== "accepted") {
        return { ...base, flagged: true, needsConfirmation: true, status: "review", reason: el.detail };
      }
      return { ...base, flagged: extracted.warningPrefixIsBold === null, needsConfirmation: false, status: "pass", reason: el.detail };
    }

    // ---- Every other element. ----
    const { value: aiRaw, confidence } = fieldFor(spec.key, extracted);
    const aiValue = (aiRaw ?? "").trim();
    const present = aiValue !== "";
    // A present field with no confidence entry is treated as low-confidence (conservative; matches completeness.ts).
    const lowConf = present && (confidence === undefined || confidence < FIELD_REVIEW_CONFIDENCE);
    const base = {
      key: spec.key, label: spec.label, necessity: spec.necessity,
      aiValue, confidence, editable: true, state: c.state,
    };

    if (c.state === "edited") {
      const edited = (c.editedValue ?? "").trim();
      if (edited === "") {
        const status: FieldStatus = spec.necessity === "mandatory" ? "fail" : "pass";
        return { ...base, value: "", flagged: spec.necessity === "mandatory", needsConfirmation: false, status,
          reason: spec.necessity === "mandatory"
            ? "Confirmed not on the label — a required element for this beverage type is missing."
            : "Not present (only required in certain cases)." };
      }
      // When the AI read nothing (field was absent), a human-supplied value is taken as ground truth.
      if (!present) {
        return { ...base, value: edited, flagged: false, needsConfirmation: false, status: "pass",
          reason: "Value supplied by the reviewer — taken as the authoritative reading." };
      }
      const { status, reason } = statusForEdit(spec.key, edited, aiValue, extracted, beverageClass);
      return { ...base, value: edited, flagged: status !== "pass", needsConfirmation: false, status, reason };
    }

    if (c.state === "accepted" && present) {
      return { ...base, value: aiValue, flagged: lowConf, needsConfirmation: false, status: "pass",
        reason: "Confirmed: matches the application." };
    }

    if (c.state === "missing" || c.state === "accepted") {
      // "accepted" reaches here only for an absent field (present is handled above) -> confirmed nothing is there.
      const status: FieldStatus = spec.necessity === "mandatory" ? "fail" : "pass";
      return { ...base, value: "", flagged: spec.necessity === "mandatory", needsConfirmation: false, status,
        reason: spec.necessity === "mandatory"
          ? "Confirmed not on the label — a required element for this beverage type is missing."
          : "Not present (only required in certain cases)." };
    }

    // ---- Unconfirmed (the AI's suggestion). ----
    if (present) {
      if (lowConf) {
        return { ...base, value: aiValue, flagged: true, needsConfirmation: true, status: "review",
          reason: "The AI wasn't fully sure it read this correctly — confirm it or type the right value." };
      }
      return { ...base, value: aiValue, flagged: false, needsConfirmation: false, status: "pass",
        reason: "Read confidently from the label." };
    }

    // Absent. Alcohol content is class-specific (table-wine substitution; malt optional).
    if (spec.key === "alcoholContent") {
      const el = evaluateAbsentAlcohol(spec, extracted, beverageClass);
      if (el.status === "present" || el.status === "unverifiable") {
        return { ...base, value: "", flagged: false, needsConfirmation: false, status: "pass", reason: el.detail };
      }
      return { ...base, value: "", flagged: true, needsConfirmation: true, status: "review",
        reason: "Not read from the label — type it if it's there, or mark it missing." };
    }
    if (spec.necessity === "mandatory") {
      return { ...base, value: "", flagged: true, needsConfirmation: true, status: "review",
        reason: "Not read from the label — type it if it's there, or mark it missing." };
    }
    return { ...base, value: "", flagged: false, needsConfirmation: false, status: "pass",
      reason: "Only required in certain cases — not on this label." };
  });

  const statuses = fields.map((f) => f.status);
  const overall = overallVerdict(statuses);
  const awaitingConfirmation = fields.some((f) => f.needsConfirmation);
  return { beverageClass, fields, overall, awaitingConfirmation };
}
