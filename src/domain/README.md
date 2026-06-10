# `src/domain/` — CFR-verified domain module

This is the one module in the project that is **human-trusted and CFR-verified**, not
loop-generated. Every constant here is grounded in the U.S. Code of Federal Regulations
(Title 27) and was checked against the eCFR and the Cornell LII mirror.

## The rule that matters

**Do NOT change a constant in this module to make a test pass.** The canonical government
warning, the per-class ABV tolerances, and the 0.5% warning-exemption threshold are
**statutory**. If a test disagrees with a value here, the test (or the calling code) is
wrong — fix that, not the statute. This mirrors the project invariant in `AGENTS.md`:
"The canonical government-warning text is statutory — NEVER reword it to pass a test."

## What's here

| File | Contents | CFR basis |
| --- | --- | --- |
| `warning.ts` | Canonical government warning (verbatim), the `GOVERNMENT WARNING:` prefix, and a note that the prefix must be all-caps + bold | 27 CFR 16.21 (text); 16.22(a)(2) (caps + bold) |
| `types.ts` | `ClaimedFields`, `ExtractedFields` (with per-field confidence and the `warningPrefixIsAllCaps` / `warningPrefixIsBold` flags), `BeverageClass` union | — |
| `tolerances.ts` | Per-`BeverageClass` tolerance table + `selectToleranceFor()` | 27 CFR 5.65(c), 4.36(b)(1)/(c), 7.65(c)/(d) |
| `alcohol.ts` | `proofToAbv` / `abvToProof` (proof = 2 × ABV) and `isWarningRequired(abv)` | 27 CFR 16.10 (0.5% exemption) |
| `labelRequirements.ts` | The per-beverage-class mandatory-elements matrix (`mandatoryElementsFor()`): which label elements TTB requires for spirits / wine / malt / cider, with the per-class nuances (malt ABV optional, wine ≤14% table-wine carve-out, conditional sulfite) | 27 CFR parts 4, 5, 7, 16 (per-row cites in the file) |
| `standardsOfFill.ts` | Authorized container sizes (standards of fill) per class + `isAuthorizedFill()` | 27 CFR 5.203 (spirits), 4.72 (wine) |
| `index.ts` | Public surface (re-exports) | — |
| `*.test.ts` | Vitest unit tests: warning verbatim, proof round-trip, `selectToleranceFor` per class, exemption boundary | — |

## Two ideas that shape the design

- **`classType` is an INPUT, not a passive field.** The beverage class *selects* the
  alcohol tolerance rule. The same labeled ABV is in-tolerance or not depending entirely on
  the class (e.g. ±0.3 pp for spirits vs. ±1.5 pp for table wine). `selectToleranceFor()`
  performs that selection.
- **The symmetric ± value is not the whole rule.** Some classes carry absolute boundary
  constraints the tolerance may not cross (the wine 14% tax-class boundary, the malt
  0.5% floor and 2.5% low/reduced cap). Those are recorded in each rule's `boundaryNote`
  and are **enforced by the comparator**, deliberately not folded into the number.

## `VERIFY before production` flags

A few values are encoded but warrant a human/legal check before any production use; each is
also flagged inline at its definition:

- **Cider classification** (`tolerances.ts`): cider has no standalone tolerance. It resolves
  to **wine** (Part 4, ±1.5 pp) by default — the common apple/pear fruit-cider case — or to
  **malt beverage** (Part 7, ±0.3 pp) when brewed from malt. Confirm the upstream classifier
  picks the right Part per product. The 8.5% ABV figure people associate with cider is a
  **tax-rate** boundary, not a labeling tolerance.
- **`unknown` class default** (`tolerances.ts`): uses the tightest band (±0.3 pp) to avoid
  false approvals, but prefer routing unknown-class labels to **human review** rather than
  auto-deciding.

## Provenance

CFR values were verified against eCFR and the Cornell LII / govinfo mirrors (re-verified
against the in-force text as of 2026-06). TTB's **2022 "Modernization" final rule — T.D.
TTB-176 (87 FR 7526, effective March 11, 2022)** renumbered the distilled-spirits and
malt-beverage labeling sections — e.g. distilled-spirits alcohol content moved from the old
27 CFR 5.37 to **5.65(c)**, and malt-beverage alcohol content to **7.65(c)**; those current
section numbers are the ones cited here. (The earlier 2020 Phase 1 rule was a *different*
Treasury Decision, T.D. TTB-158.) **Part 4 (wine) was not part of that reorganization**, so
the wine sections retain their classic numbers — `4.36(b)(1)`/`(c)` are still current.

The verbatim government-warning text was re-verified character-for-character against
27 CFR 16.21 and is **unchanged as of 2026-06**. The Surgeon General's January 2025 advisory
on alcohol and cancer risk recommended adding a cancer warning, but the ABLA statute can be
amended only by Congress and no rule or law has changed the text — re-verify this single
constant if a bill is enacted.
