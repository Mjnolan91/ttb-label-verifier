import type { Ref } from "react";
import type { ExtractedFields } from "@/domain";
import { FIELD_REVIEW_CONFIDENCE, MIN_READABLE_CONFIDENCE } from "@/compare";
import { HEADLINE_FIELDS, DETAIL_FIELDS, type FieldDescriptor } from "@/extraction/fieldCatalog";

/**
 * ExtractedFieldsView — the extraction-first output: what the AI read off the label, field by field,
 * each with the model's confidence, plus the raw JSON. The rows are DERIVED from FIELD_CATALOG (one
 * source of truth shared with the merge + CSV), split into the few headline fields shown at a glance
 * and the long tail behind a "show everything" disclosure to keep the screen calm for a 70+ agent.
 * Read-only and verdict-free (compliance pass/fail lives in the verdict headline / DecisionPanel). The
 * form moves focus to this section's heading on completion, so focus is the single announcement
 * channel (no overlapping aria-live).
 */

/** Read a catalog string field off ExtractedFields by key (all catalog value keys are string?). */
function valueOf(e: ExtractedFields, key: FieldDescriptor["key"]): string | undefined {
  return (e as unknown as Record<string, string | undefined>)[key];
}

function confidenceColor(v: number | undefined): string {
  if (typeof v !== "number") return "text-ink-muted";
  // Green above FIELD_REVIEW_CONFIDENCE, the engine's per-field trust gate. The amber/red split
  // reuses MIN_READABLE_CONFIDENCE, which the engine only applies image-level (readability); per
  // field it is purely a display boundary, borrowed so the palette tracks named constants.
  return v >= FIELD_REVIEW_CONFIDENCE ? "text-pass-900" : v >= MIN_READABLE_CONFIDENCE ? "text-review-900" : "text-fail-900";
}

function ConfidenceTag({ value }: { value: number | undefined }) {
  if (typeof value !== "number") return null;
  return (
    <span
      className={`shrink-0 text-xs font-semibold ${confidenceColor(value)}`}
      title="How sure the AI is it read this field correctly"
    >
      {Math.round(value * 100)}% confident
    </span>
  );
}

function Row({
  label,
  value,
  confidence,
}: {
  label: string;
  value: string | undefined;
  confidence?: number;
}) {
  const hasValue = typeof value === "string" && value.trim() !== "";
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
      <dt className="w-32 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">
        {hasValue ? value : <span className="italic text-ink-muted">not found</span>}
      </dd>
      <ConfidenceTag value={confidence} />
    </div>
  );
}

function Flag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-muted">
      {label}: <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}

export function ExtractedFieldsView({
  extracted,
  headingRef,
}: {
  extracted: ExtractedFields;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const c = extracted.confidence;
  // ALL the 16.22 typography flags are tri-state: name the good/violating readings, fall back to
  // "undetectable" on null/undefined. A null must NEVER render as "no" — that would claim a
  // violation reading on missing evidence ("verified" means verified, in both directions).
  const tri = (v: boolean | null | undefined, whenTrue: string, whenFalse: string): string =>
    v === true ? whenTrue : v === false ? whenFalse : "undetectable";
  return (
    <section aria-label="Extracted from the label" className="mt-6 flex flex-col gap-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      >
        Extracted from the label
      </h2>

      <div className="rounded-card border border-border bg-surface p-5 shadow-card">
        <dl>
          {HEADLINE_FIELDS.map((d) => (
            <Row key={d.key} label={d.label} value={valueOf(extracted, d.key)} confidence={c[d.confKey]} />
          ))}
        </dl>

        <details className="mt-3 border-t border-border pt-3">
          <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
            Show everything we read ({DETAIL_FIELDS.length} more fields)
          </summary>
          <dl className="mt-2">
            {DETAIL_FIELDS.map((d) => (
              <Row key={d.key} label={d.label} value={valueOf(extracted, d.key)} confidence={c[d.confKey]} />
            ))}
          </dl>
        </details>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          <Flag label="Warning prefix ALL CAPS" value={tri(extracted.warningPrefixIsAllCaps, "yes", "no")} />
          <Flag label="Warning prefix bold" value={tri(extracted.warningPrefixIsBold, "yes", "no")} />
          <Flag label="Warning body bold" value={tri(extracted.warningRemainderIsBold, "yes (violation)", "no")} />
          <Flag label="Warning readily legible" value={tri(extracted.warningIsReadilyLegible, "yes", "confirm")} />
        </div>
      </div>

      <details className="rounded-card border border-border bg-surface-muted p-4 text-sm">
        <summary className="min-h-[44px] cursor-pointer py-2 font-semibold text-ink">Raw JSON</summary>
        <pre className="mt-3 overflow-x-auto rounded-field bg-surface p-3 text-xs leading-relaxed text-ink">
          {JSON.stringify(extracted, null, 2)}
        </pre>
      </details>
    </section>
  );
}
