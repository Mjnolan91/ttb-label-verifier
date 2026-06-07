# AGENTS.md — TTB Label Verifier

This file is auto-read by the AI coding tool on every iteration. It is the source of truth
for what we are building and how. Read it fully before writing code. Append durable
learnings to the bottom.

## Mission
A standalone prototype that verifies an alcohol label image against the values claimed in
an application, for three TTB checks: **brand name**, **alcohol content**, and the
**government health warning**. It returns a fast, clear, per-field verdict that a human
agent can trust or override.

The product goal is NOT to replace human judgment. It is to be **superhuman on the axes
where machines win** — consistency, throughput, and tireless recall of routine checks —
while **routing the ambiguous cases to a human**. We win on the *cost of errors* and on
consistency, not by reading images more accurately than a person.

## Non-goals (do not build these)
- No COLA integration. This is a standalone proof-of-concept.
- No authentication, accounts, or persistence of PII. Nothing sensitive is stored.
- No image deskewing / glare correction. Handle bad images by asking for a re-upload.
- Not a platform. Prefer the simplest implementation that meets each story's criteria.

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
image ──> [ VisionProvider(s) ] ──> [ reconciler ] ──> [ deterministic comparator ] ──> result UI
            (probabilistic)          (agree/disagree)    (pure, auditable, tested)
```
- **Extraction is probabilistic** and lives behind the `VisionProvider` interface
  (`extract(image) => ExtractedFields` with per-field confidence). Providers: `mock`
  (default), `llm` (fast-tier multimodal), `ocr` (dedicated OCR / second model).
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
- **Alcohol content — numeric + tolerance.** Parse the ABV value and any proof. Apply the
  tolerance in the domain config (wine over 14% ABV gets +/-1.0 percentage point). Proof =
  2 x ABV, so cross-check "45% Alc./Vol. (90 Proof)". Out of tolerance = fail.
- **Government warning — strict.** Compare the body to the canonical statutory text below.
  Confirm the "GOVERNMENT WARNING:" prefix is present and in capital letters (and bold
  where detectable; only that prefix is bold, the remainder is not). Title-case
  ("Government Warning"), reworded, or missing = fail.

## Canonical government warning (verbatim — never edit this to pass a test)
> GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink
> alcoholic beverages during pregnancy because of the risk of birth defects. (2)
> Consumption of alcoholic beverages impairs your ability to drive a car or operate
> machinery, and may cause health problems.

Required on beverages at 0.5% ABV or above (ABLA 1988 / 27 CFR Part 16). Products under
0.5% ABV are exempt — a valid edge case to handle, not a violation.

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
- Commit one story per iteration; message format `US-00X: <title>`.

## Learnings (append-only — add patterns, gotchas, and context for future iterations)
- (none yet)
