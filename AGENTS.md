# AGENTS.md — TTB Label Verifier

This is the project bible: the source of truth for the architecture, the three compliance checks,
the canonical government-warning text, the latency budget, the thresholds philosophy, and the
conventions. Read it fully before writing code (humans and AI coding tools alike). `README.md` is
the product-facing overview; `CLAUDE.md` is a thin pointer here; this file holds the "why".

## Mission
A standalone prototype that **reads a product's label images (front/back/neck) together into the
full set of TTB-required fields** with AI, **checks the label for completeness** against TTB's
mandatory-information requirements for its beverage type (each element flagged present / missing /
malformed / unverifiable; see `src/domain/labelRequirements.ts` + `src/compare/completeness.ts`),
and exports the result as **JSON or CSV** with no manual data entry. The deterministic claimed-vs-label
comparator — **brand name**, **alcohol content**, **government health warning** → Approve / Needs-review
/ Reject — is the brief's **core check and leads the UI**, computed whenever an agent supplies an
application's claimed values; it is fully evaluated and exposed via the API. The **always-on extraction
+ completeness** result (each element flagged present / missing / malformed / not-applicable) is the
supporting layer a human agent can trust or override, and is the headline when no application values
are on hand.

The product goal is NOT to replace human judgment. It is to be **superhuman on the axes
where machines win** — consistency, throughput, and tireless recall of routine checks —
while **routing the ambiguous cases to a human**. We win on the *cost of errors* and on
consistency, not by reading images more accurately than a person.

## Non-goals (do not build these)
- No COLA integration. This is a standalone proof-of-concept.
- No authentication, accounts, or persistence of PII. Nothing sensitive is stored.
- No image deskewing / glare correction. Handle bad images by asking for a re-upload.
- Not a platform. Prefer the simplest implementation that meets the requirements.

## Hard constraints
- **Latency: a verification result must return in ~5 seconds.** This is the single most
  important constraint. When using more than one extractor, run them in PARALLEL with a
  per-call timeout (~3s) and reconcile whatever returned — never block on a straggler.
- **Accessibility / simplicity:** the UI must be usable by an agent in their 70s. One
  screen, large targets, high contrast, visible focus, keyboard navigable, no hunting.
- **Offline by default:** the app and the ENTIRE test suite must run with no network and
  no API keys, via the mock provider. Real providers are opt-in via env vars only.

## Architecture: "AI extracts, code compares"
```
image ──> [ VisionProvider(s) ] ──> [ reconciler ] ──> [ completeness + optional comparator ] ──> UI
            (probabilistic)          (agree/disagree)    (pure, auditable, tested)
```
The flow is **extraction-always, verify-first in the UI**: the AI always reads the label and code
always runs the TTB **completeness** check, but the *screen leads with* the claimed-vs-application
comparison (the brief's core check), computed the moment an agent supplies claimed values. With no
claimed values, the completeness summary is the headline. Extraction underpins both and is never
gated on the comparison. (The extracted field set has one source of truth — `src/extraction/
fieldCatalog.ts` — that the mapper, merge, field table, and CSV all derive from.)
- **Extraction is probabilistic** and lives behind the `VisionProvider` interface
  (`extract(image) => ExtractedFields` with per-field confidence). Providers: `mock` (default,
  offline), `openai` (OpenAI-direct), `gemini` (Google Gemini-direct), `llm` (Azure OpenAI
  multimodal), `ocr` (Azure AI Document Intelligence), and `ensemble` (llm + ocr reconciled). The
  three chat-model providers share one prompt + JSON parser; only the request/response dialect differs.
- **The real providers are Azure-native, and that IS the firewall-survival story.** The
  brief's outbound firewall blocks third-party AI endpoints; running *in-tenant* on Azure
  survives it. The `llm` reference impl targets **Azure OpenAI** (multimodal); the `ocr`
  reference impl targets **Azure AI Document Intelligence**. Both are configured by env vars
  only (endpoint/key/deployment), error cleanly when unset, and never touch the mock/test
  path. **The interface stays generic** — Azure is the reference implementation, not a
  hard dependency — and **`mock` remains the default; the app and full test suite run
  offline with zero keys.**
- **Reconciliation** (when 2 providers run): fields where providers agree -> high
  confidence; fields where they disagree -> flagged `review`. Disagreement is a feature,
  not a bug — it routes uncertainty to a human.
- **Comparison is deterministic.** All pass/fail/review logic is pure, side-effect-free,
  and unit-tested. Never let a model make the final compliance verdict — in a government
  context the answer to "why was this rejected?" must be rules-based and reproducible.

## The three checks
- **Brand name — fuzzy.** Normalize case, whitespace, punctuation, and smart quotes, then
  compare. Exact-after-normalization = pass; high similarity = review (show the
  discrepancy); low = fail. "STONE'S THROW" vs "Stone's Throw" must pass.
- **Alcohol content — numeric + tolerance, class-selected.** Parse the ABV value and any
  proof (proof = 2 x ABV, so cross-check "45% Alc./Vol. (90 Proof)"). The **beverage class
  is an INPUT that SELECTS the tolerance rule** — it is not a passive field. Apply the
  per-class tolerance from the domain matrix below; out of tolerance = fail. The authoritative
  values, CFR citations, and asymmetric boundary notes live in `src/domain/tolerances.ts`
  (`selectToleranceFor(beverageClass)`) — do not hard-code a tolerance in the comparator.
- **Government warning — strict.** Compare the body to the canonical statutory text below.
  Confirm the "GOVERNMENT WARNING:" prefix is present and in capital letters (and bold
  where detectable; only that prefix is bold, the remainder is not). Title-case
  ("Government Warning"), reworded, or missing = fail.

## Alcohol-content tolerance matrix (classType -> tolerance)
The full beverage matrix below is the rule set the alcohol check selects from. `classType`
(the normalized `beverageClass`) is the **input** that picks the row. Authoritative values
+ CFR citations + boundary notes live in `src/domain/tolerances.ts` — this table is the
human-readable summary, not a second source of truth (don't let the two drift).

| Beverage class | Tolerance (+/- pp) | CFR | Hard absolute limit the tolerance may NOT cross |
| --- | --- | --- | --- |
| Distilled spirits | ±0.3 | 27 CFR 5.65(c) | none (statement mandatory at any ABV, 5.65(a)) |
| Wine, ≤14% ABV | ±1.5 | 27 CFR 4.36(b)(1) | may not cross the 14% tax-class boundary (4.36(c)) — clamp band's upper edge at 14% |
| Wine, >14% ABV | ±1.0 | 27 CFR 4.36(b)(1) | may not cross the 14% tax-class boundary (4.36(c)) — clamp band's lower edge above 14% |
| Malt beverage / beer | ±0.3 | 27 CFR 7.65(c) | 0.5% ABV floor (7.65(c); labeled ≥0.5% may not actually be <0.5%); "low/reduced alcohol" only <2.5% (7.65(d)) |
| Cider / hard cider | resolves | (see below) | resolves to **wine** (Part 4, ±1.5) by default, or **malt** (Part 7, ±0.3) when brewed from malt |

**Citations note (2022 modernization).** TTB's 2022 final rule (T.D. TTB-176, eff. Mar 11, 2022)
renumbered Parts 5 (distilled spirits) and 7 (malt beverages) — hence `5.65`/`7.65` rather than the
older numbers. **Part 4 (wine) was NOT renumbered**, so the wine citations remain `4.36`.
The alcohol-content *requirement* is also per class: a numeric statement is **mandatory** for
distilled spirits and for wine >14%, but **optional by default for malt beverages** (27 CFR
7.63(a)(3)); on wine ≤14% a "table wine" / "light wine" designation may stand in for the numeric
value (27 CFR 4.36(a)). The completeness check encodes these per-class rules; the tolerance matrix
only governs *whether a stated value is within band*.

- **Cider has no standalone tolerance.** It is classified by *production method*: typical
  apple/pear fruit cider is **wine** under Part 4 (±1.5 pp); a cider brewed from malted
  barley is a **malt beverage** under Part 7 (±0.3 pp). The domain module resolves `cider`
  to wine ≤14% by default; classify malt-based cider as `maltBeverage` upstream. The 8.5%
  ABV figure is a hard-cider **tax-rate** boundary, NOT a labeling tolerance — do not encode it.
- **The symmetric ± value is not the whole rule.** The absolute limits above (wine 14% clamp
  per 4.36(c); malt 0.5% floor per 7.65(c) / 2.5% cap per 7.65(d)) are carried as `boundaryNote`
  metadata in `tolerances.ts` and **enforced by the comparator** — deliberately not folded into
  the number, because collapsing them would be incorrect.
- **`unknown` class** uses the tightest band (±0.3 pp) as a conservative product default to
  bias toward review/fail over false approval; prefer routing unknown-class labels to human
  review. (Product default, not a CFR value.)
- **VERIFY before production:** the cider wine-vs-malt resolution is a per-product
  determination; confirm the upstream classifier picks the right Part.

## Canonical government warning (verbatim — never edit this to pass a test)
> GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink
> alcoholic beverages during pregnancy because of the risk of birth defects. (2)
> Consumption of alcoholic beverages impairs your ability to drive a car or operate
> machinery, and may cause health problems.

Required on beverages at 0.5% ABV or above (ABLA 1988 / 27 CFR Part 16). Products under
0.5% ABV are exempt — a valid edge case to handle, not a violation.

The text above was re-verified character-for-character against the statute (27 CFR 16.21;
caps+bold prefix rule 16.22(a)(2); 0.5% threshold 16.10) and matches exactly — no edit was
needed. The same string is mirrored as `CANONICAL_GOVERNMENT_WARNING` in
`src/domain/warning.ts`, guarded by a verbatim unit test.

**Forward-looking note.** The 27 CFR 16.21 text is **unchanged as of 2026-06**, but it is under
advocacy pressure: the Surgeon General's January 2025 advisory on alcohol and cancer risk has
prompted calls to add a cancer warning. That is a proposal only — Congress has not amended the ABLA
statute and no rule has changed the text. The verbatim-comparison design absorbs any future change
by editing that single canonical constant.

## Thresholds (asymmetric, compliance-aware)
Optimize to minimize **false approvals**. A missed violation is far worse than an
unnecessary human review. A field/overall result passes only above a high-confidence
threshold; anything below routes to `review`. Thresholds live in `src/compare/thresholds.ts`
with the rationale documented inline.

## Evaluation
"Better than humans" must be a number, not a claim. The `eval/` harness runs the pipeline
over labeled fixtures (correct + deliberately broken) and prints per-field precision/recall
and latency p50/p95. It fails if precision on "approve" drops below a floor.

## Tech & conventions
- Next.js (App Router) + TypeScript (strict) + Tailwind. Optional: a lightweight accessible
  component set, but keep dependencies minimal.
- Suggested layout: `src/domain/`, `src/extraction/`, `src/compare/`, `src/app/` (UI + API
  route), `eval/`.
- npm scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `eval`.
- Tests use the mock provider only — no live network. Keep them fast and deterministic.
- **Hermetic fixtures: the mock keys off the image FILENAME, not image bytes.** Fixtures live
  in `eval/fixtures/` (`cases.json` + placeholder SVGs); the suite needs no real images. An
  unknown/unreadable filename must yield a deterministic below-threshold low-confidence result
  with no fabricated field value (handed to the re-upload path), reproducible from the
  filename alone.
- **Real label images are user-supplied later.** `eval/fixtures/images/MANIFEST.md` lists the
  exact paths + required specs; drop real images at those paths (keeping filenames in lockstep
  with `cases.json`) to exercise a real provider (`VISION_PROVIDER=openai`/`llm`/`ocr`) or a live
  demo. Everything passes offline without them.
- **`src/domain/` is pre-seeded and CFR-verified — do not silently change it.** It is the one
  human-trusted, hand-written module (canonical warning, tolerance matrix, 0.5% exemption,
  proof helpers). Treat its constants as statutory: extend/integrate, never reword or retune
  to make a test pass. See `src/domain/README.md`.
- **Toolchain.** Next.js (App Router) + React + TypeScript (strict) + Tailwind v4 + Vitest. Lint is
  `eslint .`, **not** `next lint` (removed in Next 16); config is the flat `eslint.config.mjs`. Tests
  run with `vitest run`, scoped to `src/**` + `eval/**` (`@`→`src` alias mirrors tsconfig `paths`);
  React component tests opt into jsdom via a `// @vitest-environment jsdom` docblock with
  `@testing-library/react`. See `CLAUDE.md` for the full command set and gotchas.
