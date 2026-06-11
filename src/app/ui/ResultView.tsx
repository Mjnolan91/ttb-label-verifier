import { useEffect, useRef, useState, type Ref } from "react";
import { FIELD_REVIEW_CONFIDENCE, MIN_READABLE_CONFIDENCE, type VerifyResult, type VerifyField, type VerifyFieldKey } from "@/compare";
import { StatusBadge } from "./StatusBadge";
import {
  toneForStatus,
  TONE_TINT,
  TONE_ICON,
  TONE_SOLID_VAR,
  VERDICT_LABEL,
  FIELD_LABEL,
  GATED_MATCH_LABEL,
  type Tone,
} from "./status";
import { IconPhoto, IconPass, IconFail } from "./icons";

/**
 * ResultView — the at-a-glance label-vs-application verdict (the spec's core: "Brand matches? ABV
 * correct? Government warning there?"). Each compared field is a claimed-vs-extracted card; the
 * headline reduces them to Approve / Needs review / Reject.
 *
 * Human-in-the-loop: the AI verdict is a STARTING POINT. Every field card carries a "Your review"
 * control so a person can confirm a field the AI flagged (a false positive) or flag a field the AI
 * passed (a false negative). The overall bubble recomputes from those decisions and "lights up" green
 * (Approve), amber (Needs review), or red (Reject) — so resolving the flags visibly turns it green.
 *
 * Status is NEVER conveyed by color alone (WCAG 1.4.1): the bubble and each card pair color with an
 * icon AND a plain text label. The parent (VerifyForm) moves focus to the heading and announces the
 * verdict in a live region.
 */

/** A human override of one field's verdict: "ok" = confirmed correct, "issue" = a real problem. */
export type FieldOverride = "ok" | "issue";

/** Labels for synthesized "completeness concern" cards (fields the application didn't supply, so they
 *  have no real comparison card). Mirrors the labels verifyLabel gives the real cards. */
const SYNTH_CONCERN_LABEL: Record<VerifyFieldKey, string> = {
  brand: "Brand name",
  classType: "Class / type designation",
  alcohol: "Alcohol content",
  netContents: "Net contents",
  name: "Producer / bottler name",
  address: "Producer / bottler address",
  countryOfOrigin: "Country of origin",
  fancifulName: "Distinctive / fanciful name",
  statementOfComposition: "Statement of composition",
  warning: "Government warning",
};

/** Concern keys that have NO comparison card in `result.fields` (the application didn't supply them) —
 *  these need a synthesized, resolvable card so a completeness-gated verdict can't get stranded. */
function synthesizedConcernKeys(
  result: VerifyResult,
  concerns?: Partial<Record<VerifyFieldKey, string>>,
): VerifyFieldKey[] {
  if (!concerns) return [];
  const present = new Set(result.fields.map((f) => f.key));
  return (Object.keys(concerns) as VerifyFieldKey[]).filter((k) => !present.has(k) && Boolean(concerns[k]));
}

const NEXT_STEP: Record<VerifyResult["overall"], string> = {
  approve: "Everything matched the application, so this label can be approved.",
  review:
    "Some items need a person to confirm. Open the label image, then mark each highlighted field below as correct or flag a problem.",
  reject:
    "A required check failed. Review the item(s) marked “No match” below before sending this back to the applicant.",
};

function isGatedMatch(f: VerifyField): boolean {
  return Boolean(f.gatedByConfidence) && f.valueStatus === "pass";
}

/** The AI's display tone for a field (the calm "verify" blue for a gated match, else its value status). */
function aiTone(f: VerifyField): Tone {
  return isGatedMatch(f) ? "verify" : f.status;
}

/** The EFFECTIVE tone after a human override (the override wins over the AI). A completeness concern on
 *  an otherwise-matching field elevates it to `review` so it visibly asks for a person's confirmation. */
function effectiveTone(f: VerifyField, override?: FieldOverride, hasConcern = false): Tone {
  if (override === "ok") return "pass";
  if (override === "issue") return "fail";
  const ai = aiTone(f);
  return hasConcern && ai === "pass" ? "review" : ai;
}

function aiLabel(f: VerifyField): string {
  return aiTone(f) === "verify" ? GATED_MATCH_LABEL : FIELD_LABEL[f.status];
}

/** Does any field carry a GENUINE AI concern (a real mismatch / discrepancy), vs. only fuzzy-read flags? */
function hasRealConcern(fields: readonly VerifyField[]): boolean {
  return fields.some((f) => f.status === "fail" || (f.status === "review" && !isGatedMatch(f)));
}

/**
 * A claimed/extracted value clamped to three lines, with a "Show more" toggle that appears ONLY
 * when text is actually hidden (measured, not guessed) — long statutory warnings stay scannable
 * without permanently hiding their tails, and short values stay exactly as calm as before.
 * Re-measured on resize; jsdom reports zero heights, so the toggle simply never renders in tests.
 */
function ClampedValue({ id, text }: { id: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return; // measure only while collapsed (expanded text never overflows)
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded]);
  return (
    <>
      <dd id={id} ref={ref} className={`mt-0.5 break-words text-ink ${expanded ? "" : "line-clamp-3"}`}>
        {text}
      </dd>
      {(clamped || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-brand-700 underline underline-offset-2 transition hover:text-brand-800 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        >
          {expanded ? "Show less" : "Show more"}
          <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
        </button>
      )}
    </>
  );
}

function ConfidenceChip({ value }: { value: number | undefined }) {
  if (typeof value !== "number") return null;
  const pct = Math.round(value * 100);
  // Green above FIELD_REVIEW_CONFIDENCE, the engine's per-field trust gate. The amber/red split
  // reuses MIN_READABLE_CONFIDENCE, which the engine only applies image-level (readability); per
  // field it is purely a display boundary, borrowed so the palette tracks named constants.
  const cls =
    value >= FIELD_REVIEW_CONFIDENCE
      ? "bg-pass-50 text-pass-900 border-pass-600"
      : value >= MIN_READABLE_CONFIDENCE
        ? "bg-review-50 text-review-900 border-review-500"
        : "bg-fail-50 text-fail-900 border-fail-600";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill border px-2 py-0.5 text-xs font-semibold ${cls}`}
      title="How clearly the AI read this value off the photo. Below 70% we ask a person to confirm. It is not a mismatch."
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

/** The per-field resolution control: confirm the AI was right, or flag a problem it missed. When the
 *  field carries a hard TTB completeness violation (`concern`), confirming it overrides a statutory check,
 *  so "Looks correct" takes a deliberate second step rather than clearing the violation on one click. */
function ReviewControls({
  field,
  override,
  onOverride,
  concern,
  note,
  onNote,
}: {
  field: VerifyField;
  override?: FieldOverride;
  onOverride: (key: VerifyFieldKey, value: FieldOverride | undefined) => void;
  concern?: string;
  note?: string;
  onNote?: (key: VerifyFieldKey, text: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const toggle = (v: FieldOverride) => {
    setConfirming(false);
    onOverride(field.key, override === v ? undefined : v);
  };
  // Setting "ok" on a field with an unresolved hard violation asks first; everything else applies at once.
  const onLooksCorrect = () => {
    if (concern && override !== "ok") setConfirming(true);
    else toggle("ok");
  };
  const base =
    "inline-flex min-h-[36px] items-center gap-1.5 rounded-field border px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";
  return (
    <div className="mt-3 border-t border-current/15 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Your review</span>
        <button
          type="button"
          onClick={onLooksCorrect}
          aria-pressed={override === "ok"}
          className={`${base} ${
            override === "ok"
              ? "border-pass-700 bg-pass-700 text-white"
              : "border-border-strong bg-surface text-ink hover:border-pass-600 hover:text-pass-700"
          }`}
        >
          <IconPass className="h-4 w-4" /> Looks correct
        </button>
        <button
          type="button"
          onClick={() => toggle("issue")}
          aria-pressed={override === "issue"}
          className={`${base} ${
            override === "issue"
              ? "border-fail-700 bg-fail-700 text-white"
              : "border-border-strong bg-surface text-ink hover:border-fail-600 hover:text-fail-700"
          }`}
        >
          <IconFail className="h-4 w-4" /> Flag a problem
        </button>
        {override && (
          <span className="text-xs text-ink-muted">
            The AI said {aiLabel(field)}.{" "}
            <button
              type="button"
              onClick={() => onOverride(field.key, undefined)}
              className="font-semibold text-brand-700 underline underline-offset-2 focus-visible:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-brand-700"
            >
              Reset to AI
            </button>
          </span>
        )}
      </div>
      {confirming && concern && (
        <div role="alert" className="mt-3 rounded-field border-l-4 border-fail-600 bg-fail-50 p-3 text-sm text-fail-900">
          <p>
            <span className="font-semibold">Override a TTB requirement?</span> Marking{" "}
            <strong>{field.label}</strong> correct clears a compliance check: {concern}
          </p>
          <p className="mt-1">Confirm only if you have verified on the label image that it actually complies.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => toggle("ok")}
              className={`${base} border-fail-700 bg-fail-700 text-white hover:bg-fail-800`}
            >
              <IconPass className="h-4 w-4" /> Yes, mark correct
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`${base} border-border-strong bg-surface text-ink hover:border-brand-600 hover:text-brand-700`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* The note (their words on why it's flagged / what they confirmed) feeds the applicant email. To
          keep cards calm it opens by default only when FLAGGING a problem (where an explanation matters)
          or when a note already exists; a confirmed field offers a quiet "Add a note". */}
      {override &&
        onNote &&
        (override === "issue" || (note ?? "").trim() !== "" || addingNote ? (
          <NoteEditor field={field} override={override} note={note} onNote={onNote} />
        ) : (
          <button
            type="button"
            onClick={() => setAddingNote(true)}
            className="mt-3 inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-brand-700 underline underline-offset-2 transition hover:text-brand-800 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          >
            + Add a note
          </button>
        ))}
    </div>
  );
}

/** A per-field reviewer note with an explicit save. The textarea is a DRAFT; "Save note" commits it
 *  (which is what feeds the applicant email), and a clear "Saved" state shows it took — so a typed note
 *  is never silently lost or left in limbo. */
function NoteEditor({
  field,
  override,
  note,
  onNote,
}: {
  field: VerifyField;
  override: FieldOverride;
  note?: string;
  onNote: (key: VerifyFieldKey, text: string) => void;
}) {
  const saved = note ?? "";
  const [draft, setDraft] = useState(saved);
  // Resync the draft when the committed note changes from OUTSIDE (switching products in the batch drawer,
  // a reset) — the React-sanctioned "adjust state during render" pattern, no effect.
  const [prevSaved, setPrevSaved] = useState(saved);
  if (saved !== prevSaved) {
    setPrevSaved(saved);
    setDraft(saved);
  }
  const dirty = draft.trim() !== saved.trim();
  const hasSaved = saved.trim() !== "";
  const btn =
    "inline-flex min-h-[36px] items-center gap-1.5 rounded-field px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";
  return (
    <div className="mt-3">
      <label htmlFor={`note-${field.key}`} className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Note {override === "issue" ? "(what's wrong?)" : "(optional)"}
      </label>
      <textarea
        id={`note-${field.key}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder={
          override === "issue"
            ? "Explain the problem. Saving adds it to the applicant email."
            : "Add a note. Saving adds it to the applicant email."
        }
        className="mt-1 w-full resize-y rounded-field border-2 border-border-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink shadow-sm transition focus-visible:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => onNote(field.key, draft)}
          disabled={!dirty}
          className={`${btn} border-2 border-brand-600 bg-brand-600 text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <IconPass className="h-4 w-4" /> Save note
        </button>
        {hasSaved && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-pass-900">
            <IconPass className="h-3.5 w-3.5" /> Saved, added to the applicant email
          </span>
        )}
        {dirty && hasSaved && <span className="text-xs font-semibold text-review-900">Unsaved changes</span>}
        {hasSaved && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              onNote(field.key, "");
            }}
            className="text-xs font-semibold text-ink-muted underline underline-offset-2 transition hover:text-fail-700 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          >
            Remove note
          </button>
        )}
      </div>
    </div>
  );
}

/** For a CLEAN, passing field we don't show the full resolve/flag pair (it would clutter every match);
 *  just a quiet "Flag a problem" so a false negative the AI missed can still be raised. */
function SubtleFlag({
  fieldKey,
  onOverride,
}: {
  fieldKey: VerifyFieldKey;
  onOverride: (key: VerifyFieldKey, value: FieldOverride | undefined) => void;
}) {
  return (
    <div className="mt-3 border-t border-current/15 pt-2.5">
      <button
        type="button"
        onClick={() => onOverride(fieldKey, "issue")}
        className="inline-flex min-h-[32px] items-center gap-1.5 text-xs font-semibold text-ink-muted transition hover:text-fail-700 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
      >
        <IconFail className="h-3.5 w-3.5" /> Flag a problem
      </button>
    </div>
  );
}

function FieldCard({
  field,
  index,
  onViewImage,
  override,
  onOverride,
  concern,
  note,
  onNote,
}: {
  field: VerifyField;
  index: number;
  onViewImage?: () => void;
  override?: FieldOverride;
  onOverride?: (key: VerifyFieldKey, value: FieldOverride | undefined) => void;
  /** A TTB completeness problem on this element (missing / wrong format) even though the value matched —
   *  surfaces the full confirm/flag pair so the reviewer can clear it or escalate it. */
  concern?: string;
  /** The reviewer's free-text note on this field, and the setter (when the cards are editable). */
  note?: string;
  onNote?: (key: VerifyFieldKey, text: string) => void;
}) {
  // A concern only matters while the reviewer hasn't acted; once they confirm/flag, their call governs.
  const hasConcern = Boolean(concern) && !override;
  const tone = effectiveTone(field, override, hasConcern);
  const Icon = TONE_ICON[tone];
  const badge =
    override === "ok"
      ? "Confirmed by you"
      : override === "issue"
        ? "Problem flagged"
        : hasConcern
          ? FIELD_LABEL.review
          : tone === "verify"
            ? GATED_MATCH_LABEL
            : FIELD_LABEL[field.status];
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
          <StatusBadge tone={tone} label={badge} />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Application{field.key === "warning" ? " (statutory text)" : ""}
          </dt>
          <ClampedValue id={`field-${field.key}-claimed`} text={field.claimed} />
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">On the label</dt>
          <ClampedValue id={`field-${field.key}-extracted`} text={field.extracted} />
        </div>
      </dl>
      <p className="mt-3 text-sm">{field.reason}</p>
      {hasConcern && (
        <p className="mt-2 rounded-field border-l-4 border-review-500 bg-review-50 px-3 py-2 text-sm text-review-900">
          <span className="font-semibold">TTB completeness:</span> {concern} Confirm it on the label, or
          flag the problem.
        </p>
      )}
      {(isGatedMatch(field) || hasConcern) && onViewImage && <ViewPhotoButton onClick={onViewImage} />}
      {/* Full resolve/flag controls when there IS a flag, a completeness concern, or the human already
          acted; an otherwise-clean match shows just a quiet "Flag a problem" so the screen stays calm. */}
      {onOverride &&
        (aiTone(field) !== "pass" || override || hasConcern ? (
          <ReviewControls
            field={field}
            override={override}
            onOverride={onOverride}
            concern={concern}
            note={note}
            onNote={onNote}
          />
        ) : (
          <SubtleFlag fieldKey={field.key} onOverride={onOverride} />
        ))}
    </li>
  );
}

export function ResultView({
  result,
  overall,
  gatedByCompleteness = false,
  headingRef,
  onViewImage,
  overrides,
  onOverride,
  concerns,
  notes,
  onNote,
  step,
  heading = "Label vs. application",
  nextStepOverride,
}: {
  result: VerifyResult;
  /** The headline verdict (comparison gated on completeness, recomputed after human overrides). */
  overall?: VerifyResult["overall"];
  gatedByCompleteness?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onViewImage?: () => void;
  /** Per-field human overrides, keyed by field. */
  overrides?: Partial<Record<VerifyFieldKey, FieldOverride>>;
  /** Records a human override (or clears it with `undefined`). When omitted, the cards are read-only. */
  onOverride?: (key: VerifyFieldKey, value: FieldOverride | undefined) => void;
  /** A TTB completeness problem per field (missing / wrong format) even though the value matched —
   *  shown on the matching card so the reviewer can confirm or flag it. */
  concerns?: Partial<Record<VerifyFieldKey, string>>;
  /** The reviewer's per-field notes, and the setter for them. */
  notes?: Partial<Record<VerifyFieldKey, string>>;
  onNote?: (key: VerifyFieldKey, text: string) => void;
  /** Optional step eyebrow (e.g. "Step 3") for the single screen's numbered flow; the batch review
   *  drawer omits it, so its heading carries no orphaned step number. */
  step?: string;
  /** Section heading. The batch drawer's completeness-only review overrides the default so a label
   *  with NO application values never masquerades as a "Label vs. application" comparison. */
  heading?: string;
  /** Overrides the next-step sentence under the verdict (same completeness-only honesty). */
  nextStepOverride?: string;
}) {
  const headline = overall ?? result.overall;
  const tone: Tone = toneForStatus(headline); // green / amber / red traffic-light
  const OverallIcon = TONE_ICON[tone];
  const solid = TONE_SOLID_VAR[tone];

  // The reassuring copy fires only while the review is purely fuzzy-read driven and the human hasn't
  // flagged anything; the bubble stays amber (traffic-light) but the message says "almost there".
  const anyFlagged = result.fields.some((f) => overrides?.[f.key] === "issue");
  const gatedMatches = result.fields.filter(isGatedMatch);
  const calmReadReview =
    headline === "review" &&
    !gatedByCompleteness &&
    !hasRealConcern(result.fields) &&
    !anyFlagged &&
    gatedMatches.length > 0;

  const nextStep =
    nextStepOverride ??
    (calmReadReview
      ? `Everything you entered matched the label, with no mismatches found. We read ${
          gatedMatches.length === 1 ? "one value" : `${gatedMatches.length} values`
        } from a slightly fuzzy photo. Confirm the highlighted field${gatedMatches.length === 1 ? "" : "s"} below (or open the label image) to approve.`
      : NEXT_STEP[headline]);

  return (
    <section aria-label="Verification result" className="mt-6 flex flex-col gap-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-semibold uppercase tracking-wide text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      >
        {step ? `${step} · ` : ""}
        {heading}
      </h2>

      <div
        className={`flex items-start gap-4 rounded-card border-l-8 p-6 motion-safe:animate-reveal ${TONE_TINT[tone]}`}
        style={{ boxShadow: `0 14px 38px -16px ${solid}, 0 1px 2px rgb(15 23 42 / 0.05)` }}
      >
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-sm"
          style={{ backgroundColor: solid }}
          aria-hidden="true"
        >
          {OverallIcon && <OverallIcon className="h-7 w-7 text-white" />}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Overall verdict</p>
          <p className="text-3xl font-bold tracking-tight">{VERDICT_LABEL[headline]}</p>
          <p className="mt-1.5 text-sm leading-relaxed">{nextStep}</p>
          {gatedByCompleteness && (
            <p className="mt-1.5 text-sm font-medium leading-relaxed">
              The label-vs-application values matched, but a field TTB requires for this beverage type is
              missing or in the wrong format. See the completeness check below.
            </p>
          )}
          {/* Bridge to the terminal step: the cards above are interactive, the decision panel is below. */}
          {onOverride && (
            <p className="mt-1.5 text-sm leading-relaxed opacity-90">
              {headline === "approve"
                ? "Looks good. Record your decision below."
                : "Resolve the highlighted fields below, then record your decision."}
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
          <FieldCard
            key={field.key}
            field={field}
            index={i}
            onViewImage={onViewImage}
            override={overrides?.[field.key]}
            onOverride={onOverride}
            concern={concerns?.[field.key]}
            note={notes?.[field.key]}
            onNote={onNote}
          />
        ))}
        {/* A TTB completeness problem on a field the application did NOT supply has no comparison card —
            without this it would strand the verdict on "Needs review" with no way to resolve it. We
            synthesize a resolvable card so the reviewer can confirm (the AI missed it) or flag it, using
            the SAME override flow as the real cards. */}
        {onOverride &&
          synthesizedConcernKeys(result, concerns).map((key, i) => (
            <FieldCard
              key={`concern-${key}`}
              field={{
                key,
                label: SYNTH_CONCERN_LABEL[key],
                status: "review",
                claimed: "Not supplied in the application",
                extracted: "See the completeness note below",
                reason: "",
              }}
              index={result.fields.length + i}
              override={overrides?.[key]}
              onOverride={onOverride}
              concern={concerns?.[key]}
              note={notes?.[key]}
              onNote={onNote}
            />
          ))}
      </ul>
    </section>
  );
}
