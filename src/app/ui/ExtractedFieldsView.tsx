import type { Ref } from "react";
import type { ExtractedFields } from "@/domain";

/**
 * ExtractedFieldsView — the extraction-first headline output: what the AI read off the label,
 * field by field, each with the model's confidence, plus the raw JSON. Read-only and verdict-free
 * (compliance pass/fail lives in the optional ResultView). The form moves focus to this section's
 * heading on completion, so focus is the single announcement channel (no overlapping aria-live).
 */

function confidenceColor(v: number | undefined): string {
  if (typeof v !== "number") return "text-ink-muted";
  return v >= 0.7 ? "text-pass-700" : v >= 0.5 ? "text-review-700" : "text-fail-700";
}

function ConfidenceTag({ value }: { value: number | undefined }) {
  if (typeof value !== "number") return null;
  return (
    <span className={`shrink-0 text-xs font-semibold ${confidenceColor(value)}`} title="Model confidence">
      {Math.round(value * 100)}% conf.
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
  const boldText =
    extracted.warningPrefixIsBold === true
      ? "yes"
      : extracted.warningPrefixIsBold === false
        ? "no"
        : "undetectable";
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
          <Row label="Brand" value={extracted.brand} confidence={c.brand} />
          {extracted.class ? <Row label="Class" value={extracted.class} confidence={c.class} /> : null}
          <Row label="Type" value={extracted.classType} confidence={c.classType} />
          <Row label="Alcohol" value={extracted.alcoholContentText} confidence={c.alcoholContent} />
          <Row label="Net contents" value={extracted.netContents} confidence={c.netContents} />
          <Row label="Name" value={extracted.name} confidence={c.name} />
          <Row label="Address" value={extracted.address} confidence={c.address} />
          {extracted.countryOfOrigin ? (
            <Row label="Country of origin" value={extracted.countryOfOrigin} confidence={c.countryOfOrigin} />
          ) : null}
          {extracted.appellation ? (
            <Row label="Appellation" value={extracted.appellation} confidence={c.appellation} />
          ) : null}
          {extracted.vintage ? <Row label="Vintage" value={extracted.vintage} confidence={c.vintage} /> : null}
          {extracted.varietal ? <Row label="Varietal" value={extracted.varietal} confidence={c.varietal} /> : null}
          {extracted.sulfiteDeclaration ? (
            <Row label="Sulfites" value={extracted.sulfiteDeclaration} confidence={c.sulfiteDeclaration} />
          ) : null}
          {extracted.ageStatement ? (
            <Row label="Age statement" value={extracted.ageStatement} confidence={c.ageStatement} />
          ) : null}
          {extracted.commodityStatement ? (
            <Row label="Commodity" value={extracted.commodityStatement} confidence={c.commodityStatement} />
          ) : null}
          <Row label="Gov. warning" value={extracted.warningText} confidence={c.warningText} />
        </dl>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          <Flag label="Warning prefix ALL CAPS" value={extracted.warningPrefixIsAllCaps ? "yes" : "no"} />
          <Flag label="Warning prefix bold" value={boldText} />
        </div>
      </div>

      <details className="rounded-card border border-border bg-surface-muted p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-ink">Raw JSON</summary>
        <pre className="mt-3 overflow-x-auto rounded-field bg-surface p-3 text-xs leading-relaxed text-ink">
          {JSON.stringify(extracted, null, 2)}
        </pre>
      </details>
    </section>
  );
}
