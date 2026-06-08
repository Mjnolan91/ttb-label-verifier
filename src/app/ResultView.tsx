import type { Ref } from "react";
import type { VerifyResult, FieldResult } from "@/compare";
import { StatusBadge } from "./ui/StatusBadge";
import { toneForStatus, TONE_TINT, TONE_ICON } from "./ui/status";

/**
 * ResultView — at-a-glance claimed-vs-label verdict.
 *
 * Status is NEVER conveyed by color alone (WCAG 1.4.1): the banner and each card pair the color
 * with an icon AND a text label (PASS/REVIEW/FAIL, Approve/Needs review/Reject) via the shared tone
 * system. The verdict is shown in response to an explicit "Check" action, and focus is moved to its
 * heading — so a single announcement channel (focus) is used, with no overlapping aria-live region.
 */

const OVERALL_LABEL: Record<VerifyResult["overall"], string> = {
  approve: "Approve",
  review: "Needs review",
  reject: "Reject",
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
        <StatusBadge tone={tone} label={field.status.toUpperCase()} className="ml-auto" />
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
  headingRef,
}: {
  result: VerifyResult;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const tone = toneForStatus(result.overall);
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
        className={`flex items-center gap-4 rounded-card border-l-8 p-5 shadow-card motion-safe:animate-reveal ${TONE_TINT[tone]}`}
      >
        {OverallIcon && <OverallIcon className="h-9 w-9 shrink-0" />}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Overall verdict</p>
          <p className="text-2xl font-bold">{OVERALL_LABEL[result.overall]}</p>
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
