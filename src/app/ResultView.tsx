import type { Ref } from "react";
import type { VerifyResult, FieldResult, FieldStatus } from "@/compare";

/**
 * ResultView (US-007) — at-a-glance verdict.
 *
 * Status is NEVER conveyed by color alone (WCAG 1.4.1): each card and the banner pair the color
 * with an icon AND a text label (PASS/REVIEW/FAIL, Approve/Needs review/Reject). All status text
 * is dark-on-light-tint (>=4.5:1) and badges are white-on-700 (>=4.5:1). The whole region is an
 * aria-live status, and focus is moved to its heading on completion (keyboard/screen-reader).
 */

const FIELD_STYLE: Record<
  FieldStatus,
  { badge: string; icon: string; box: string; text: string; badgeBg: string }
> = {
  pass: {
    badge: "PASS",
    icon: "✓",
    box: "border-green-600 bg-green-50",
    text: "text-green-900",
    badgeBg: "bg-green-700",
  },
  review: {
    badge: "REVIEW",
    icon: "⚠",
    box: "border-amber-500 bg-amber-50",
    text: "text-amber-900",
    badgeBg: "bg-amber-700",
  },
  fail: {
    badge: "FAIL",
    icon: "✕",
    box: "border-red-600 bg-red-50",
    text: "text-red-900",
    badgeBg: "bg-red-700",
  },
};

const OVERALL_STYLE: Record<
  VerifyResult["overall"],
  { label: string; icon: string; box: string }
> = {
  approve: { label: "Approve", icon: "✓", box: "border-green-600 bg-green-50 text-green-900" },
  review: { label: "Needs review", icon: "⚠", box: "border-amber-500 bg-amber-50 text-amber-900" },
  reject: { label: "Reject", icon: "✕", box: "border-red-600 bg-red-50 text-red-900" },
};

const FIELDS: { key: "brand" | "alcohol" | "warning"; name: string }[] = [
  { key: "brand", name: "Brand name" },
  { key: "alcohol", name: "Alcohol content" },
  { key: "warning", name: "Government warning" },
];

function FieldCard({ name, field }: { name: string; field: FieldResult }) {
  const s = FIELD_STYLE[field.status];
  return (
    <li className={`rounded-lg border-l-4 ${s.box} p-4`}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">
          {s.icon}
        </span>
        <h3 className={`font-semibold ${s.text}`}>{name}</h3>
        <span
          className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${s.badgeBg}`}
        >
          {s.badge}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">Claimed</dt>
          <dd className="mt-0.5 line-clamp-3 break-words text-slate-900">{field.claimed}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">Extracted</dt>
          <dd className="mt-0.5 line-clamp-3 break-words text-slate-900">{field.extracted}</dd>
        </div>
      </dl>
      <p className={`mt-3 text-sm ${s.text}`}>{field.reason}</p>
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
  const overall = OVERALL_STYLE[result.overall];
  return (
    <section role="status" aria-live="polite" aria-atomic="true" className="mt-6 flex flex-col gap-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
      >
        Verification result
      </h2>

      <div className={`flex items-center gap-3 rounded-xl border-l-8 ${overall.box} p-4`}>
        <span aria-hidden="true" className="text-2xl">
          {overall.icon}
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide">Overall verdict</p>
          <p className="text-2xl font-bold">{overall.label}</p>
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {FIELDS.map(({ key, name }) => (
          <FieldCard key={key} name={name} field={result[key]} />
        ))}
      </ul>
    </section>
  );
}
