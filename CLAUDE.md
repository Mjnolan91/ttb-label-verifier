# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Before doing anything, read `AGENTS.md` at the repo root.** It is the single source of
truth for the architecture, the three compliance checks, the canonical government-warning
text, the latency budget, the thresholds philosophy, and all conventions. Keep this file a
thin pointer to it — don't copy architecture or CFR rules in here, or the two will drift.

- Product/technical context and the "why": `specs/PROJECT_SPEC.md`
- The CFR-verified domain module (statutory constants, never retune to pass a test): `src/domain/README.md`

The app is **verify-first**: the UI leads with the claimed-vs-application comparison
(brand / alcohol content / government warning → Approve/Review/Reject) — the brief's core check —
computed once the application's per-type required fields are supplied. Underneath, the AI still
extracts the **full** TTB field set and code runs the TTB **completeness** check per beverage type
(the supporting layer that kills manual data entry); with no application values on hand, the single
screen prompts for the application and completeness stays a collapsed supporting check. Offline by
default; no PII, no auth, no COLA.

## Commands
- `npm run dev` — app at http://localhost:3000 (mock provider, no keys needed)
- `npm test` — full unit + integration suite (Vitest, mock provider, no network). Component tests
  (`*.test.tsx`) switch to jsdom via a `// @vitest-environment jsdom` docblock (`@testing-library/react`).
- `npx vitest run src/compare/text.test.ts` — a single test FILE; add `-t "<name>"` to filter
  by test name. Bare `npx vitest` runs in watch mode.
- `npm run typecheck` / `npm run lint` — strict TypeScript (`tsc --noEmit`) + `eslint .`
  (NOT `next lint` — removed in Next 16; flat config in `eslint.config.mjs`)
- `npm run build` — production build (Next `output: "standalone"`)
- `npm run eval` — per-field precision/recall + latency p50/p95 over `eval/fixtures` (tsx CLI;
  entry `eval/run.ts`, which calls `runEval` from `eval/evaluate.ts`). It is a GATE: exits non-zero
  if approve-precision drops below `APPROVE_PRECISION_FLOOR` (0.98, in `eval/evaluate.ts`) — a false
  approval is the one error class we refuse to ship.
- `npx tsx scripts/measure-live-latency.ts [baseUrl] [rounds]` — end-to-end `/api/verify` p50/p95
  against a DEPLOYED target (the offline eval can't prove the ~5s budget; the mock skips the model
  call). Sequential, verdict-checked; costs real model calls — keep rounds modest.
- `npx tsx scripts/check-gemini-tier.ts` — empirically verify the Gemini key's QUOTA TIER (bursts
  the pro judge model; the tier follows the Google Cloud project the key was minted in, and the
  free tier caps pro at ~25 req/min — the classic silent cause of judge fallbacks).

Requires Node ≥20.9 (`package.json` `engines`); a wrong major version fails confusingly.

`typecheck` → `lint` → `test` is the load-bearing feedback loop; keep all three green (plus
`npm run eval`) before any commit. The suite runs offline on the mock provider — no keys, no network.
CI (`.github/workflows/ci.yml`) runs the same gate — typecheck → lint → test → eval → build — on
every push/PR to main, also offline on the mock.

## Architecture as built (where the AGENTS.md pipeline lives)
AGENTS.md describes the `image → VisionProvider(s) → reconciler → (optional) comparator → UI`
pipeline and the "why". As built, the load-bearing pieces are:
- **`src/pipeline.ts`** — `runExtraction()` reads a product's images (front/back/neck) → readability
  gate; the PRIMARY path. On chat providers a MULTI-IMAGE product is read JOINTLY by default
  (`extractAll` + `selfConsistentExtractJoint`: ALL images ride ONE request per sample as
  position-labeled separate image parts — never a stitched bitmap, which would halve per-label
  resolution under the vision APIs' caps; `JOINT_EXTRACTION=0` opts out), so fields get cross-panel
  context and a 2-image product pays samples requests, not images×samples; a model-reported
  cross-panel conflict (`crossImageConflicts`) is capped into the review band, review-gated and
  rescue-ineligible, never silently resolved (`applyCrossImageConflictCaps`). Providers WITHOUT
  `extractAll` (mock, ocr — hence the offline suite/eval and the Azure ensemble) read EACH image
  separately and MERGE (`mergeExtracted`). Each read is sampled N times
  (self-consistency, `selfConsistentExtract`); per-field confidence becomes the AGREEMENT fraction
  across samples — better calibrated than the model's self-reported confidence. The vote CLUSTERS
  samples by the merge's tolerant equivalence (`valuesAgree`: cosmetic variance is one reading,
  numeric differences never cluster); on a borderline VERDICT-RELEVANT field it can draw ONE extra
  batch and re-vote (`SELF_CONSISTENCY_ESCALATION`, OPT-IN, default 0 by measurement — contested
  reads pay an extra batch). `SELF_CONSISTENCY_SAMPLES`
  (default 3; `src/extraction/config.ts`) sets N; the mock provider is forced to 1 so the offline
  suite/eval stay deterministic (and never escalates). After the merge, a LOW-CONFIDENCE RESCUE
  (`src/extraction/rescue.ts`, default ON, `LOW_CONFIDENCE_RESCUE=0` disables) re-reads any
  verdict-relevant field still below the 0.7 gate on the provider's STRONG judge model — ONE
  bounded call, ALL images, ONLY the contested fields: cross-model agreement boosts the field
  above the gate; disagreement adopts the strong read but stays in review (a rescue clears false
  alarms, never silently flips a conflict to pass; the mock has no `readFields`, so offline never
  rescues). The rescue runs on its OWN budget (`resolveRescueTimeoutMs`, default ≥10s,
  `RESCUE_TIMEOUT_MS`) — sharing the per-sample straggler cap made it a guaranteed dead timeout
  (2026-06-10 RCA). An image whose read fails entirely drops out of the merge but is REPORTED
  (`failedImages` → API `imageFailures` → warning banner + retry on the verify screen, row note in
  batch): a dropped back label must never masquerade as a clean front-only read — that silent drop
  under a 5000ms cap was the Bonnaire capture regression. When a warning is read, a dedicated `judgeWarningBold` pass over the
  images sets `warningPrefixIsBold` (capped at min(samples, 3) votes per image,
  `resolveWarningJudgeSamples`/`WARNING_JUDGE_SAMPLES` — one boolean needs no 7-way burst; the
  per-image verdicts are MAJORITY-VOTED across images, never first-non-null; on gemini AND openai the judge DEFAULTS to the strongest model,
  `GeminiVisionProvider.DEFAULT_JUDGE_MODEL` / `OpenAIVisionProvider.DEFAULT_JUDGE_MODEL`, falling
  back to the extraction model when that
  call fails; `WARNING_JUDGE_MODEL` pins/upgrades it per provider; an UNVERIFIABLE caps/bold
  prefix routes the warning to review in `compareWarning` — "verified" is never claimed on
  missing evidence). When the warning is REQUIRED but still missing or format-unverified after
  the merge/judge/rescue, the WARNING FOCUS escalation (`src/extraction/warningFocus.ts`, default
  ON, `WARNING_FOCUS=0` off, own per-stage budget `WARNING_FOCUS_TIMEOUT_MS`) runs ONE strong-model
  locate pass (any orientation) then crops/derotates/upscales the region (sharp, a declared prod
  dependency) and re-judges from the zoomed crop; a RECOVERED warning lands at review-band
  confidence (never a silent pass — the statutory text is in every model's training data), an
  agreeing transcript clears the gate, and a lone violation signal never hard-fails
  (`combineViolationSignals`, the mirror of `combineBoldSignals`, guards the remainder-bold rule).
  DELIBERATE REVIEW HOLDS ARE UNTOUCHABLE (`warningTextUntouchable`): the conflict band
  (<= DISAGREEMENT_CONFIDENCE — mirrors the rescue's FP-3 carve-out) and rescue-adopted values
  (`ExtractedFields.strongReadAdopted` — the same strong model re-agreeing with its own words is
  not independent evidence) neither trigger nor accept the pass's text/flags/boost.
  The mock has no `focusWarning`, so offline/eval never run it. On the Gemini provider, extraction stays on Flash by measurement (Pro
  extraction blew the ~5s budget and its 25 req/min quota; see README "Measured, not claimed");
  the same fast-extracts/strong-judges split holds on OpenAI (gpt-4.1 + gpt-5.5 judge). `runVerification()` adds the claimed comparison. `/api/verify`
  always extracts + runs the TTB **completeness** check (`src/compare/completeness.ts` over
  `src/domain/labelRequirements.ts`); it also returns a claimed-comparison verdict when
  `brand`+`alcoholContent` are posted. Batch pairs front/back by filename (`src/batch/pairing.ts`;
  `parsePositionToken` is the exported per-filename parser — null means NO explicit token, which the
  single screen's multi-file `placeFiles` distribution needs) and resolves each product's claimed
  values from an optional CSV (`src/batch/claimedMatch.ts`). After the merge a deterministic ORIGIN
  HARVEST (`src/extraction/harvest.ts`) fills an EMPTY countryOfOrigin from a printed
  "PRODUCT OF <named country>" the samples misallocated to a sibling field (samples flap on field
  allocation; plain code over already-read text, never a model call). The presence-instability cap
  is TIERED (`selfConsistency.ts`): a supermajority dropout (>=75% of samples agree, the rest dropped
  the field) lands at 0.65 — review-gated but rescue-eligible — while genuine and numeric splits keep
  the hard 0.3. Batch reads run through `src/app/batch/pacing.ts` (bounded-persistent auto-retry:
  full-jitter backoff, 6 attempts, only 429/502/503/504/network; adaptive AIMD concurrency, honest
  per-row "retrying" notes + "Retry all failed"); ANY re-read (manual Retry, auto-retry, combine)
  calls `worklist.invalidateReview` — stale confirms/decisions must never survive onto a new read.
  A row that settles CLEANLY but with mandatory elements MISSING gets the SECOND LOOK
  (`src/extraction/secondLook.ts` + `/api/verify/focus`; `SECOND_LOOK=0` disables): ONE delayed
  (~12s) background re-read of exactly the missing fields on the strong model's `readFields`,
  merged FILL-EMPTY-ONLY at review-band confidence 0.65 (caught and surfaced, never silently
  passed — original-read-missed + focused-read-found is presence instability, the same signal the
  tiered cap stamps); the merge invalidates review, rows a person already judged are skipped,
  warning format flags are never set by it, and the row note narrates every outcome (found / still
  missing / unsupported on the mock). Supersession checks live INSIDE the setRows updaters (the
  rowsRef mirror can lag a fast timer; a stale mirror must read as "unknown", never "replaced").
  Rows lead with a thumbnail; same-brand rows offer a human-confirmed COMBINE (`groupOverrides` +
  `mergePositions` — never a fuzzy auto-merge). Change the flow here, not in two places.
- **`src/domain/`** — pre-seeded, CFR-verified, the one hand-written human-trusted module
  (canonical warning, tolerance matrix, label-requirements matrix, standards-of-fill enumerations,
  proof helper). Treat its constants
  as statutory: extend/integrate, never reword or retune them to make a test pass. The completeness
  matrix encodes the per-class nuance (malt ABV optional by default; wine ≤14% table-wine carve-out;
  warning exempt <0.5% ABV — the exemption ABV is parsed from `alcoholContentText`; sulfite is
  **conditional** per 27 CFR 4.32(e), surfaced not failed). `standardsOfFill.ts` enumerates the
  authorized container sizes (spirits 27 CFR 5.203 / wine 4.72, per the Jan 2025 final rule; malt has
  NO standard of fill) — an unlisted size routes to REVIEW, never hard-fail, since TTB periodically
  adds sizes. See `src/domain/README.md`.
- **`src/extraction/`** — the `VisionProvider` interface + `MockVisionProvider` (default; keys
  off the image FILENAME, not bytes) + `Llm`/`Ocr` Azure providers + `OpenAI`-direct + `Gemini`-direct
  providers (env-gated via `VISION_PROVIDER` — `mock`|`llm`|`ocr`|`openai`|`gemini`|`ensemble`, opt-in;
  full env matrix in `.env.example`) + `reconcile.ts` (runs providers in PARALLEL with a per-call
  timeout — ~3s mock / ~8s real, `VISION_TIMEOUT_MS`; disagreement → review, tolerant of
  punctuation/spacing/typo noise). The OpenAI/Gemini/Azure chat providers share `SYSTEM_PROMPT`/
  `USER_PROMPT`/`parseModelJson` (in `LlmVisionProvider.ts`); only the request dialect differs.
  The disagreement→review reconciliation only fires under `ensemble` (runs BOTH Azure providers):
  `getActiveProviders()` returns that list, `getVisionProvider()` the single. The real providers use
  strict **structured outputs** (`response_format: json_schema`), bounded retry on 429/5xx
  (`fetchWithRetry`), and a self-limiting request timeout (`withHardTimeout`) — see `http.ts`.
  `selfConsistency.ts` (+ `config.ts`) wraps the reconciler with the N-sample agreement pass the
  pipeline drives; `geminiTuning.ts`/`openaiTuning.ts` hold per-provider request tuning —
  the OpenAI side is FAMILY-AWARE (`chatParams`): gpt-5/o-series reasoning models reject
  `max_tokens` and non-default `temperature`, need `max_completion_tokens` with reasoning
  headroom, and get a low reasoning effort to stay in the latency budget (env-tunable via
  `OPENAI_REASONING_EFFORT`, default low).
- **`src/compare/`** — pure, deterministic comparators + `verifyLabel` (claimed comparison) +
  `completeness.ts` (each TTB-required element present / missing / malformed / unverifiable, per
  beverage type) + `thresholds.ts`. Two DISTINCT thresholds, easy to confuse:
  `MIN_READABLE_CONFIDENCE` (0.5 — is the image readable at all → re-upload path) vs
  `FIELD_REVIEW_CONFIDENCE` (0.7 — trust this field's verdict, else downgrade to `review`).
  `combinedVerdict` (`reviewVerdict.ts`) is the auditable HEADLINE verdict: it takes the worse of the
  claimed-vs-label comparison (`verifyLabel`) and the per-type completeness check, so a label missing
  a TTB-required field for its beverage type can't be Approved (a missing/malformed mandatory element
  → `review`; the warning keeps its hard fail). The **eval** AND the interactive single screen both read
  this combined verdict — same engine, no parallel UI verdict logic. `verifyLabel` compares the FULL
  application field-by-field — brand, class/type, alcohol, net contents, producer name, producer
  address, country of origin, distinctive/fanciful name, statement of composition (each compared ONLY
  when the application supplies it) plus the auto government warning — and returns an ordered
  `VerifyResult.fields` list (with `brand`/`alcohol`/`warning` named accessors kept for the eval/CSV).
  Each comparator biases uncertainty to `review`;
  class/type uses `resolveBeverageClass` so a broad application class ("distilled spirits") matches the
  label's specific designation ("Kentucky Straight Bourbon Whiskey"); `origin.ts` infers
  domestic-vs-import deterministically (importer line, foreign producer address, "Product of ..."),
  so an import with NO printed country statement is flagged instead of slipping through, and a
  domestic label never demands one. Match is NOT compliance on origin: a printed statement that
  names a REGION ("Imported from the Caribbean") instead of a country routes to review even when
  it matches the application verbatim (`namedCountryIn`; the producer address suggests the likely
  country), and completeness marks it malformed on an import. `toClaimedFields` (also in
  `reviewVerdict.ts`) is the BATCH screen's "enough to compare?" rule (brand always; alcohol only
  where the law mandates it for the resolved class — spirits / wine >14% / unknown — so a legal malt
  or table-wine application without an ABV still gets a verdict); the
  single screen instead gates on the per-type required-input set (`requiredInputKeysFor`,
  `src/compare/requiredInputs.ts`), and `combinedVerdict` keeps a brand-only safety net since alcohol
  is not mandatory for every class. (Historical note: a `confirmVerdict`/`ConfirmPanel` confirm-to-approve layer existed briefly
  and was removed 2026-06-09 when the screen was realigned to lead with the comparison — ignore older
  docs/plans that reference it.)
- **`src/app/`** — verify-first single screen (`VerifyForm`: front/back upload — plus a neck/strip
  slot disclosed by an "Add a neck or strip label" button — + auto-read on upload,
  plus "The application" inputs. The REQUIRED input set is DYNAMIC per beverage type
  (`requiredInputKeysFor` over the CFR matrix: brand/class/net/producer name/address always; alcohol
  only for spirits / wine >14% / unknown); country of origin, fanciful name, and statement of
  composition are compared when listed. The AI's reading pre-fills each input as a gray suggestion
  (Tab to accept, or the "Accept all AI suggestions" button), and a beverage-type selector re-derives
  the required set. Once every required field is filled the results LEAD with `ResultView` — the
  field-by-field label-vs-application comparison (`combinedVerdict`) → Approve/Needs review/Reject;
  until then the headline is a **"Complete the application to verify"** prompt (the label read is shown,
  but completeness is a collapsed SUPPORTING check, NEVER the headline). The completeness breakdown +
  `ExtractedFieldsView` sit in collapsed disclosures. Thumbnails open the accessible `ImageLightbox`; a
  non-blocking `ForwardLookingNote` lists 2025 proposals) + `/api/verify` route + `/batch`; `src/app/ui/` holds
  shared primitives. Each application input has a `FieldHelp` "?" toggletip (copy lives ONCE in
  `src/app/ui/fieldHelpCopy.ts`, typed so a new input without copy fails the build; the file is named
  fieldHelpCopy, not fieldHelp, because Windows is case-insensitive and `FieldHelp.tsx` would collide).
  The header has a `HelpButton` "?" beside `ThemeToggle` (layout.tsx stays a server component; the
  button is the client leaf) opening the help panel in the shared `Drawer` (`closeLabel` prop). Modal
  dialogs inert BOTH `#main-content` and the fixed `#site-controls` header wrapper, and the
  set/restore is NESTING-SAFE (the batch drawer opens an `ImageLightbox` on top of itself). The
  batch worklist renders as a 4-track GRID LIST (never a sideways-scrolling table): triage filter
  chips + attention-first sort + row tints; EVERY settled row is reviewable (unreadable rows record
  a send-back, errored rows get a per-row Retry, no-CSV rows start as an honest completeness-only
  review whose missing elements are resolvable concern cards via `labelReview`/`ProductReview` — and
  the drawer's `ApplicationEditor` lets the reviewer SUPPLY or correct application values in place:
  persisted edits OVERLAY the matched CSV row (an explicit "" clears a CSV value), ANY edit
  invalidates the review — ALL confirm/flag overrides AND any recorded decision drop, the row
  returns to Undecided (a stale "ok" or a stale "Approved" must never force-pass a recomputed
  comparison) — and the verdict derives at render — NOT cached at analyze time — via
  `deriveProductVerdict` (`src/app/batch/productVerdict.ts`), the ONE derivation shared by the row
  badges/triage, the drawer, and both exports. The nine application-input descriptors (labels/hints/
  suggestion+confidence mapping) live ONCE in `src/app/ui/appInputs.ts`, consumed by BOTH VerifyForm
  and ApplicationEditor). **`eval/`** — the harness and filename-keyed fixtures (`eval/fixtures/cases.json`).
- **`src/extraction/fieldCatalog.ts`** — THE single source of truth for the extracted field set. One
  ordered descriptor list (`key`/`rawKey`/`confKey`/`label`/`csvColumn`/`group`) that the raw→domain
  mapper (`extractedShape.ts`), the front/back merge (`reconcile.ts`), the field table
  (`ExtractedFieldsView`), and the CSV (`batch/csv.ts`) all derive from — add a field here, not in six
  places. JSON and CSV exports therefore cover the same fields.

## Gotchas
- **Reading arbitrary images needs a real provider; the default mock only knows the built-in test
  fixtures.** The mock (default, zero keys) keys off the FILENAME and returns the `extracted` block
  from `eval/fixtures/cases.json` — so it only "reads" those fixture filenames, not arbitrary uploads.
  To read ANY uploaded image, set `VISION_PROVIDER` to a real provider — `openai`/`gemini` (simplest;
  one API key, no Azure resource) or `llm`/`ocr`/`ensemble` (Azure in-tenant). The hosted Vercel demo
  runs a real provider (OpenAI gpt-4.1 + gpt-5.5 warning judge, via env vars; switched from Gemini
  2026-06-10); Azure is the documented in-tenant production target;
  the deployed URL runs a real provider. The verify screen offers the demo SAMPLE PRODUCT — the
  Fireball front/back pair (real artwork from the public TTB COLA registry; an IMPORT, so it also
  exercises the importer-line + "Product of Canada" origin path) plus its non-bold-warning back
  (an EDITED test artifact; the real label is compliant) — via one-click "Load the sample label" /
  "Load the defective-warning version" BUTTONS ("No label handy?") that fetch from
  `public/samples/` and run the files through the SAME `placeFiles` path an upload takes
  (filenames intact, both slots placed at once, one read; the help panel still offers the files as
  downloads). The served files are byte-copies of `eval/fixtures/images/fireball-*.jpg` kept in
  lockstep by `scripts/make-fireball-demo.cjs` (writes BOTH directories; its SOURCE artwork lives
  OUTSIDE the repo) and guarded by `src/app/samples.test.ts` (byte-equality). They ARE fixtures
  (filename-keyed; the eval covers each panel ALONE, the demo pair merges to approve on the verify
  screen), so the mock reads them locally, and it tolerates a browser download-rename like
  `fireball-front (1).jpg`. The old `demo-*.png` trio (generate-demo-labels.cjs) and the Fear the
  Dragon trio (make-fear-the-dragon-demo.cjs) remain as eval fixtures only. Rename a sample and
  you must update `eval/fixtures/cases.json` + the README walkthrough together.
- **Uploads are downscaled in the browser first.** `src/app/imageDownscale.ts` shrinks phone photos
  to ~2000px longest edge (JPEG) to fit the latency/token budget. It NEVER throws (falls back to the
  original) and PRESERVES the filename — so the filename-keyed mock still resolves. Don't rename the
  file on that path; tune the cap via `DEFAULT_MAX_EDGE` there.
- **Deployment: the public demo is on Vercel; Azure is the in-tenant production target.** Vercel
  hosts the public demo (auto-deploys from `main`, runs a real provider via env vars) — the quick way
  to share a working URL. Azure is the production story *on purpose* (in-tenant = the firewall-survival
  story): multi-stage `Dockerfile` + Next `output: "standalone"`, shipping to Azure App Service or
  Container Apps. The app runs end-to-end in mock mode with ZERO keys. Step-by-step commands for both
  live in the README ("Deploying") — the source of truth; don't duplicate them here.
- **The government-warning text is statutory (27 CFR 16.21) and verbatim** — never reword it to pass
  a test. It was re-verified unchanged as of 2026-06 (the 2025 Surgeon General cancer advisory is a
  proposal, not law). It lives once in `src/domain/warning.ts`, guarded by a verbatim unit test.
- **The reviewer-facing approach document is GENERATED — never hand-edit it.**
  `docs/TTB-Label-Verifier-Approach-and-Design.docx` (and the `.pdf` exported from it) are built by
  `scripts/make-submission-doc.cjs`; the `docx` package is deliberately NOT a project dependency
  (run the script from an out-of-repo scratch dir per its header). Its hardcoded
  `TEST_COUNT`/`FILE_COUNT`/`EVAL_CASES` constants drift when the suite grows: update them to the
  current numbers first, regenerate the .docx, re-export the PDF, and commit both together.
