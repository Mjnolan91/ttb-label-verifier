import type { Ref } from "react";
import type { VerifyResult, VerifyField } from "@/compare";
import { StatusBadge } from "./StatusBadge";
import {
  toneForStatus,
  TONE_TINT,
  TONE_ICON,
  VERDICT_LABEL,
  FIELD_LABEL,
  GATED_MATCH_LABEL,
  type Tone,
} from "./status";
import { IconPhoto } from "./icons";

/**
 * ResultView — the at-a-glance label-vs-application verdict (the spec's core: "Brand matches? ABV
 * correct? Government warning there?"). Each compared field is a claimed-vs-extracted card; the
 * headline reduces them (gated on per-type completeness) to Approve / Needs review / Reject.
 *
 * The screen now distinguishes FOUR field states, not three. A field whose VALUES matched but whose
 * photo read was below the trust threshold (`gatedByConfidence && valueStatus === "pass"`) gets a calm
 * blue "Match · confirm photo" treatment — categorically different from the orange "Needs review" a
 * genuine discrepancy gets. The underlying verdict is unchanged (still review; a human should glance);
 * only the presentation stops looking like a rejection of a correct match.
 *
 * Status is NEVER conveyed by color alone (WCAG 1.4.1): the banner and each card pair the color with
 * an icon AND a plain text label via the shared tone system. The parent (VerifyForm) moves focus to
 * the heading and announces the verdict in a live region so the reactive path is not silent for AT.
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

/** Is this field a value MATCH that is only flagged because the photo read was fuzzy? */
function isGatedMatch(f: VerifyField): boolean {
  return Boolean(f.gatedByConfidence) && f.valueStatus === "pass";
}

/** The display tone for a field: the calm "verify" blue for a gated match, else the value status. */
function fieldTone(f: VerifyField): Tone {
  if (isGatedMatch(f)) return "verify";
  return f.status; // pass | review | fail are all valid tones
}

/** Does any field carry a GENUINE concern (a real mismatch / discrepancy), vs. only fuzzy-read flags? */
function hasRealConcern(fields: readonly VerifyField[]): boolean {
  return fields.some((f) => f.status === "fail" || (f.status === "review" && !isGatedMatch(f)));
}

/** A small pill showing how clearly the AI read this value off the photo (the gate's trigger number,
 *  made visible at the point of confusion). Color mirrors the readability bands (≥0.7 / ≥0.5 / below). */
function ConfidenceChip({ value }: { value: number | undefined }) {
  if (typeof value !== "number") return null;
  const pct = Math.round(value * 100);
  const cls =
    value >= 0.7
      ? "bg-pass-50 text-pass-900 border-pass-600"
      : value >= 0.5
        ? "bg-review-50 text-review-900 border-review-500"
        : "bg-fail-50 text-fail-900 border-fail-600";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill border px-2 py-0.5 text-xs font-semibold ${cls}`}
      title="How clearly the AI read this value off the photo. Below 70% we ask a person to confirm — it is not a mismatch."
    >
      {pct}% read
    </span>
  );
}

function ViewPhotoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-field border border-brand-600 bg-surface px-3 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
    >
      <IconPhoto className="h-4 w-4" /> View label photo
    </button>
  );
}

function FieldCard({
  field,
  index,
  onViewImage,
}: {
  field: VerifyField;
  index: number;
  onViewImage?: () => void;
}) {
  const tone = fieldTone(field);
  const Icon = TONE_ICON[tone];
  const badgeLabel = tone === "verify" ? GATED_MATCH_LABEL : FIELD_LABEL[field.status];
  return (
    <li
      className={`rounded-card border-l-4 p-4 shadow-card motion-safe:animate-reveal ${TONE_TINT[tone]}`}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {Icon && <Icon className="h-5 w-5 shrink-0" />}
        <h3 className="font-semibold">{field.label}</h3>
        <div className="ml-auto flex items-center gap-2">
          <ConfidenceChip value={field.readConfidence} />
          <StatusBadge tone={tone} label={badgeLabel} />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Application{field.key === "warning" ? " (statutory text)" : ""}
          </dt>
          <dd className="mt-0.5 line-clamp-3 break-words text-ink">{field.claimed}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">On the label</dt>
          <dd className="mt-0.5 line-clamp-3 break-words text-ink">{field.extracted}</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm">{field.reason}</p>
      {isGatedMatch(field) && onViewImage && <ViewPhotoButton onClick={onViewImage} />}
    </li>
  );
}

export function ResultView({
  result,
  overall,
  gatedByCompleteness = false,
  headingRef,
  onViewImage,
}: {
  result: VerifyResult;
  /** The headline verdict (the comparison gated on completeness); defaults to the comparison's own. */
  overall?: VerifyResult["overall"];
  /** True when the 3 checks passed/were lenient but a missing required field made the verdict worse. */
  gatedByCompleteness?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Opens the label image (the actual remedy for a fuzzy-read flag). Wired from VerifyForm. */
  onViewImage?: () => void;
}) {
  const headline = overall ?? result.overall;

  // Why is the headline "Needs review"? If every flagged field is a value MATCH held only for a fuzzy
  // photo read (no real discrepancy, not gated by a missing TTB element), the verdict is reassuring,
  // not an alarm — render it calm (blue) with copy that says so, instead of the generic orange.
  const gatedMatches = result.fields.filter(isGatedMatch);
  const calmReadReview =
    headline === "review" && !gatedByCompleteness && !hasRealConcern(result.fields) && gatedMatches.length > 0;

  const tone: Tone = calmReadReview ? "verify" : toneForStatus(headline);
  const OverallIcon = TONE_ICON[tone];

  const nextStep = calmReadReview
    ? `Everything you entered matched the label — no mismatches were found. We read ${
        gatedMatches.length === 1 ? "one value" : `${gatedMatches.length} values`
      } from a slightly fuzzy photo, so a person should glance at the image to confirm before approving.`
    : NEXT_STEP[headline];

  return (
    <section aria-label="Verification result" className="mt-6 flex flex-col gap-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-semibold uppercase tracking-wide text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      >
        Step 3 · Label vs. application
      </h2>

      <div
        className={`flex items-start gap-4 rounded-card border-l-8 p-6 shadow-card motion-safe:animate-reveal ${TONE_TINT[tone]}`}
      >
        {OverallIcon && <OverallIcon className="h-9 w-9 shrink-0" />}
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Overall verdict</p>
          <p className="text-3xl font-bold tracking-tight">{VERDICT_LABEL[headline]}</p>
          <p className="mt-1.5 text-sm leading-relaxed">{nextStep}</p>
          {gatedByCompleteness && (
            <p className="mt-1.5 text-sm font-medium leading-relaxed">
              The label-vs-application values matched, but a field TTB requires for this beverage type is
              missing or couldn&apos;t be read confidently — see the completeness check below.
            </p>
          )}
          {calmReadReview && onViewImage && (
            <button
              type="button"
              onClick={onViewImage}
              className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-field border border-brand-600 bg-surface px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              <IconPhoto className="h-4 w-4" /> View label photo
            </button>
          )}
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {result.fields.map((field, i) => (
          <FieldCard key={field.key} field={field} index={i} onViewImage={onViewImage} />
        ))}
      </ul>
    </section>
  );
}
