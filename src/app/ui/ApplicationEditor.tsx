"use client";

/**
 * ApplicationEditor — the batch drawer's "The application" section: the same nine inputs the single
 * screen offers, so a reviewer can supply or correct a product's application values without leaving
 * the worklist (no CSV row, or a CSV gap, is no longer a dead end). The verdict recomputes live as
 * they type (pure client-side compare, single-screen parity) and every change persists to the
 * worklist record.
 *
 * Deliberate differences from the single screen, because this lives inside a focus-trapped Drawer:
 *  - NO Tab-to-accept: Tab is the dialog's navigation key, and an accidental acceptance here would be
 *    PERSISTED. Each suggestion gets an explicit "Use suggestion" button instead (better for the
 *    70-year-old agent anyway).
 *  - "Accept all" stays MOUNTED (disabled when done) and moves focus to the first input on use, so
 *    the focused element never unmounts inside the trap.
 *  - No beverage-type selector: typing the class/type (e.g. "Wine") drives the same resolver the
 *    selector would (resolveBeverageClass), one less control in an already-tall drawer.
 * Provenance is explicit: each value is chipped "from CSV" / "edited by you" / "from label" so the
 * application of record stays auditable, and a CSV value a reviewer overrode can be restored.
 */
import { useId, useRef, useState } from "react";
import type { ExtractedFields } from "@/domain";
import { FIELD_REVIEW_CONFIDENCE } from "@/compare";
import type { ApplicationValues } from "../batch/productVerdict";
import type { ApplicationEdits } from "../batch/useWorklist";
import { APP_FIELD_HELP, type AppInputKey } from "./fieldHelpCopy";
import { APP_INPUT_SPECS, appInputConfidence, appInputSuggestion, countryOfOriginImportNote } from "./appInputs";
import { AppValueField } from "./AppValueField";
import { FieldHelp } from "./FieldHelp";
import { inputClass } from "./fieldStyles";
import { IconPass } from "./icons";

/** The amber treatment for a low-confidence AI suggestion (mirrors the single screen). */
const LOW_CONF_INPUT =
  "min-h-[44px] w-full rounded-field border-2 border-review-500 bg-review-50 px-3 py-2.5 text-ink " +
  "placeholder:text-review-900 shadow-sm transition focus-visible:outline-none focus-visible:border-brand-600 " +
  "focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

export function ApplicationEditor({
  extracted,
  values,
  csvValues,
  edits,
  onChange,
  claimedNeeds,
  hasVerdict,
}: {
  extracted: ExtractedFields;
  /** The effective application (CSV overlaid with edits) — what each input displays. */
  values: ApplicationValues | null;
  /** The matched CSV row's values (provenance + "Reset to CSV"), or null when no row matched. */
  csvValues: ApplicationValues | null;
  /** The reviewer's persisted edits (provenance: an edit overrides the CSV). */
  edits: ApplicationEdits;
  onChange: (key: AppInputKey, value: string) => void;
  /** When values exist but the verdict gate needs more, the human list of what to add. */
  claimedNeeds?: string;
  /** Whether the comparison verdict is currently computed (drives the open/collapsed default). */
  hasVerdict: boolean;
}) {
  // One mounted editor per open drawer; useId keeps the input ids valid (no product-name spaces).
  const idBase = useId();
  const firstInputRef = useRef<HTMLTextAreaElement>(null);

  const suggestionFor = (key: AppInputKey): string | undefined => appInputSuggestion(extracted, key);
  const confidenceFor = (key: AppInputKey): number | undefined => appInputConfidence(extracted, key);

  const valueOf = (key: AppInputKey): string => values?.[key] ?? "";
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const acceptable = APP_INPUT_SPECS.filter((f) => {
    const s = suggestionFor(f.key);
    return Boolean(s && s.trim()) && valueOf(f.key).trim() === "";
  });
  const anySuggestion = APP_INPUT_SPECS.some((f) => suggestionFor(f.key)?.trim());

  function acceptAll() {
    for (const f of acceptable) onChange(f.key, (suggestionFor(f.key) ?? "").trim());
    // Keep focus deterministic inside the Drawer's focus trap: the button disables itself after
    // accepting, so park focus on the first input rather than stranding it on a disabled control.
    firstInputRef.current?.focus();
  }

  // Open when the reviewer's attention is needed (no verdict yet, or the gate names missing values);
  // collapsed when a matched CSV row already produced a verdict. The condition seeds the INITIAL
  // state only and onToggle keeps React's value equal to the DOM's afterwards: a live-controlled
  // `open` would force-collapse the section on the exact keystroke that first completes the verdict
  // gate, hiding the focused input mid-word inside the Drawer's focus trap. The editor mounts fresh
  // per drawer open, so the initial computation is correct per product.
  const [open, setOpen] = useState(() => !hasVerdict || Boolean(claimedNeeds));

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="rounded-card border border-border bg-surface-muted p-4"
    >
      <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
        The application
        {claimedNeeds ? (
          <span className="ml-2 font-normal text-review-900">Add {claimedNeeds} to verify</span>
        ) : !hasVerdict ? (
          <span className="ml-2 font-normal text-ink-muted">No values yet. Add them to verify</span>
        ) : (
          <span className="ml-2 font-normal text-ink-muted">Values the label is verified against</span>
        )}
      </summary>
      <p className="mt-1 text-sm text-ink-muted">
        The values the application claims, compared against the label. The AI&apos;s reading is offered
        as a suggestion under each empty field. Changes save in this browser and the verdict updates as
        you type.
      </p>
      {anySuggestion && (
        <button
          type="button"
          onClick={acceptAll}
          disabled={acceptable.length === 0}
          className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-field bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconPass className="h-4 w-4" />
          {acceptable.length === 0 ? "All suggestions accepted" : "Accept all AI suggestions"}
        </button>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {APP_INPUT_SPECS.map((f, i) => {
          const id = `${idBase}-app-${f.key}`;
          const value = valueOf(f.key);
          const suggestion = suggestionFor(f.key);
          const hasSuggestion = Boolean(suggestion && suggestion.trim());
          const confidence = confidenceFor(f.key);
          const lowConf = hasSuggestion && typeof confidence === "number" && confidence < FIELD_REVIEW_CONFIDENCE;
          const csv = (csvValues?.[f.key] ?? "").trim();
          const edited = f.key in edits;
          const provenance =
            edited && value.trim() !== ""
              ? hasSuggestion && norm(value) === norm(suggestion ?? "")
                ? "from label"
                : "edited by you"
              : !edited && csv !== "" && value.trim() === csv
                ? "from CSV"
                : null;
          const showSuggestion = hasSuggestion && value.trim() === "";
          const importNote = f.key === "countryOfOrigin" ? countryOfOriginImportNote(extracted) : undefined;
          const hintId = `${id}-hint`;
          const metaId = `${id}-meta`;
          const noteId = `${id}-import-note`;
          const describedBy = [
            showSuggestion ? hintId : null,
            lowConf || provenance ? metaId : null,
            importNote ? noteId : null,
          ]
            .filter(Boolean)
            .join(" ");
          const needsAttention = Boolean(claimedNeeds) && (f.key === "brand" || f.key === "alcoholContent") && value.trim() === "";
          return (
            <div key={f.key}>
              {/* The label row holds ONLY constant-height content (label + "?"): the chips live
                  BELOW the input, because anything variable ABOVE it wraps to a second line and
                  shifts this cell's input out of alignment with its grid-row neighbor. */}
              <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink">
                <label htmlFor={id}>
                  {f.label}
                  {f.hint && <span className="font-normal text-ink-muted"> ({f.hint})</span>}
                </label>
                <FieldHelp label={f.label} text={APP_FIELD_HELP[f.key]} />
              </div>
              <AppValueField
                ref={i === 0 ? firstInputRef : undefined}
                id={id}
                value={value}
                onValueChange={(v) => onChange(f.key, v)}
                placeholder={showSuggestion ? suggestion : undefined}
                aria-describedby={describedBy || undefined}
                className={lowConf || needsAttention ? LOW_CONF_INPUT : inputClass}
              />
              {(lowConf || provenance) && (
                <span id={metaId} className="mt-1 flex flex-wrap items-center gap-1.5">
                  {lowConf && (
                    <span className="rounded-pill border border-review-500 bg-review-50 px-1.5 py-0.5 text-xs font-semibold text-review-900">
                      Low confidence ({Math.round((confidence ?? 0) * 100)}%)
                    </span>
                  )}
                  {provenance && (
                    <span className="rounded-pill border border-border bg-surface px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                      {provenance}
                    </span>
                  )}
                </span>
              )}
              {importNote && (
                <span id={noteId} className="mt-1 block break-words text-xs font-medium text-review-900">
                  {importNote}
                </span>
              )}
              {showSuggestion && (
                <span id={hintId} className="mt-1 flex flex-wrap items-center gap-2 break-words text-xs text-ink-muted">
                  <span>
                    AI read: <span className="font-medium text-ink">{suggestion}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange(f.key, (suggestion ?? "").trim())}
                    className="font-semibold text-brand-700 underline underline-offset-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                  >
                    Use suggestion
                  </button>
                </span>
              )}
              {edited && csv !== "" && value.trim() !== csv && (
                <span className="mt-1 block text-xs text-ink-muted">
                  CSV row: <span className="font-medium text-ink">{csv}</span>{" "}
                  <button
                    type="button"
                    onClick={() => onChange(f.key, csv)}
                    className="font-semibold text-brand-700 underline underline-offset-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                  >
                    Reset to CSV
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
