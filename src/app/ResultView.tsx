import type { Ref } from "react";
import type { VerifyResult, FieldResult } from "@/compare";
import { StatusBadge } from "./ui/StatusBadge";
import { toneForStatus, TONE_TINT, TONE_ICON, VERDICT_LABEL, FIELD_LABEL } from "./ui/status";

/**
 * ResultView — at-a-glance claimed-vs-label verdict.
 *
 * Status is NEVER conveyed by color alone (WCAG 1.4.1): the banner and each card pair the color
 * with an icon AND a plain text label (Match/Needs review/No match, Approve/Needs review/Reject) via
 * the shared tone system. Focus is moved to the result heading; a parent live region in VerifyForm
 * also announces the verdict so the reactive (type-after-read) path is not silent for AT users.
 */

/** A plain next-action line under the verdict, so a non-technical agent knows what to DO, not just
 *  the status. Keyed off the same overall verdict — pure presentation, no new logic. */
const NEXT_STEP: Record<VerifyResult["overall"], string> = {
  approve: "Everything matched the application — this label can be approved.",
  review:
    "Some items need a person to confirm. Open the label image and check the highlighted fields below.",
  reject:
    "A required check failed. Review the item(s) marked “No match” below before sending this back to the applicant.",
};

const FIELDS: { key: "brand" | "alcohol" | "warning"; name: string }[] = [
  { key: "brand", name: "Brand name" },
  { key: "alcohol", name: "Alcohol content" },
  { key: "warning", name: "Government warning" },
];

function FieldCard({ name, field, index }: { name: string; field: FieldResult; index: number }) {
  const tone = field.status; // pass | review | fail are all valid tones
  const Icon = TONE_ICON[tone];
  return (
    <li
      className={`rounded-card border-l-4 p-4 shadow-card motion-safe:animate-reveal ${TONE_TINT[tone]}`}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5 shrink-0" />}
        <h3 className="font-semibold">{name}</h3>
        <StatusBadge tone={tone} label={FIELD_LABEL[field.status]} className="ml-auto" />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Claimed</dt>
          <dd className="mt-0.5 line-clamp-3 break-words text-ink">{field.claimed}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Extracted</dt>
          <dd className="mt-0.5 line-clamp-3 break-words text-ink">{field.extracted}</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm">{field.reason}</p>
    </li>
  );
}

export function ResultView({
  result,
  overall,
  gatedByCompleteness = false,
  headingRef,
}: {
  result: VerifyResult;
  /** The headline verdict (the comparison gated on completeness); defaults to the comparison's own. */
  overall?: VerifyResult["overall"];
  /** True when the 3 checks passed/were lenient but a missing required field made the verdict worse. */
  gatedByCompleteness?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const headline = overall ?? result.overall;
  const tone = toneForStatus(headline);
  const OverallIcon = TONE_ICON[tone];
  return (
    <section aria-label="Verification result" className="mt-6 flex flex-col gap-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      >
        Verification result
      </h2>

      <div
        className={`flex items-start gap-4 rounded-card border-l-8 p-5 shadow-card motion-safe:animate-reveal ${TONE_TINT[tone]}`}
      >
        {OverallIcon && <OverallIcon className="h-9 w-9 shrink-0" />}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Overall verdict</p>
          <p className="text-2xl font-bold">{VERDICT_LABEL[headline]}</p>
          <p className="mt-1 text-sm">{NEXT_STEP[headline]}</p>
          {gatedByCompleteness && (
            <p className="mt-1 text-sm font-medium">
              The three checks matched, but a field TTB requires for this beverage type is missing or
              couldn&apos;t be read confidently — see the completeness check below.
            </p>
          )}
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {FIELDS.map(({ key, name }, i) => (
          <FieldCard key={key} name={name} field={result[key]} index={i} />
        ))}
      </ul>
    </section>
  );
}
