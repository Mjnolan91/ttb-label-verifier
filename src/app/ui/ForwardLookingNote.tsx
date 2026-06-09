/**
 * ForwardLookingNote — a small, collapsed, NON-BLOCKING note listing 2025 TTB proposals that are not
 * yet law. The tool enforces only in-force rules; this surfaces regulatory awareness without affecting
 * any verdict. (See AGENTS.md "Forward-looking note" and the law research in the spec.)
 */

const PROPOSALS: { title: string; detail: string }[] = [
  {
    title: "Cancer-risk health warning",
    detail:
      "The Surgeon General's January 2025 advisory urges Congress to add a cancer warning to the statutory text. Only Congress can amend it (warning text at 27 U.S.C. 215 / 27 CFR 16.21; amendment mechanism at 27 U.S.C. 219a) — no bill has passed, so the warning text is unchanged.",
  },
  {
    title: "“Alcohol Facts” statement",
    detail:
      "TTB proposed rule (Notice 237, Jan 2025) would add a serving-facts panel (serving size, ABV, calories, carbohydrates, fat, protein). Still a proposal — no final rule.",
  },
  {
    title: "Major food allergen labeling",
    detail:
      "TTB proposed rule (Notice 238, Jan 2025) would require declaring the nine major food allergens when used. Still a proposal — no final rule.",
  },
];

export function ForwardLookingNote() {
  return (
    <details className="mt-6 rounded-card border border-border bg-surface-muted p-4 text-sm">
      <summary className="min-h-[44px] cursor-pointer py-2 font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
        Forward-looking: proposed rules (not checked)
      </summary>
      <p className="mt-2 text-ink-muted">
        This tool checks only labeling rules in force as of 2026. These 2025 proposals are tracked but
        intentionally <strong className="text-ink">not</strong> enforced:
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {PROPOSALS.map((p) => (
          <li key={p.title}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{p.title}</span>
              <span className="rounded-pill border border-border bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">
                Proposed — not yet required
              </span>
            </div>
            <p className="mt-0.5 text-ink-muted">{p.detail}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
