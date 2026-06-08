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
computed the moment application values are supplied. Underneath, the AI still extracts the **full**
TTB field set and code runs the TTB **completeness** check per beverage type (the supporting layer
that kills manual data entry); with no application values on hand, the completeness summary is the
headline. Offline by default; no PII, no auth, no COLA.

## Commands
- `npm run dev` — app at http://localhost:3000 (mock provider, no keys needed)
- `npm test` — full unit + integration suite (Vitest, mock provider, no network). Component tests
  (`*.test.tsx`) switch to jsdom via a `// @vitest-environment jsdom` docblock (`@testing-library/react`).
- `npx vitest run src/compare/text.test.ts` — a single test FILE; add `-t "<name>"` to filter
  by test name. Bare `npx vitest` runs in watch mode.
- `npm run typecheck` / `npm run lint` — strict TypeScript (`tsc --noEmit`) + `eslint .`
  (NOT `next lint` — removed in Next 16; flat config in `eslint.config.mjs`)
- `npm run build` — production build (Next `output: "standalone"`)
- `npm run eval` — per-field precision/recall + latency p50/p95 over `eval/fixtures` (tsx CLI).
  It is a GATE: exits non-zero if approve-precision drops below `APPROVE_PRECISION_FLOOR` (0.98,
  in `eval/evaluate.ts`) — a false approval is the one error class we refuse to ship.

`typecheck` → `lint` → `test` is the load-bearing feedback loop; keep all three green (plus
`npm run eval`) before any commit. The suite runs offline on the mock provider — no keys, no network.

## Architecture as built (where the AGENTS.md pipeline lives)
AGENTS.md describes the `image → VisionProvider(s) → reconciler → (optional) comparator → UI`
pipeline and the "why". As built, the load-bearing pieces are:
- **`src/pipeline.ts`** — `runExtraction()` reads EACH of a product's images (front/back/neck) and
  MERGES them (`mergeExtracted`) → readability gate; the PRIMARY path. `runVerification()` adds the
  claimed comparison. `/api/verify` always extracts + runs the TTB **completeness** check
  (`src/compare/completeness.ts` over `src/domain/labelRequirements.ts`); it also returns a
  claimed-comparison verdict when `brand`+`alcoholContent` are posted. Batch pairs front/back by
  filename (`src/batch/pairing.ts`). Change the flow here, not in two places.
- **`src/domain/`** — pre-seeded, CFR-verified, the one hand-written human-trusted module
  (canonical warning, tolerance matrix, label-requirements matrix, proof helper). Treat its constants
  as statutory: extend/integrate, never reword or retune them to make a test pass. The completeness
  matrix encodes the per-class nuance (malt ABV optional by default; wine ≤14% table-wine carve-out;
  warning exempt <0.5% ABV — the exemption ABV is parsed from `alcoholContentText`; sulfite is
  **conditional** per 27 CFR 4.32(e), surfaced not failed). See `src/domain/README.md`.
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
- **`src/compare/`** — pure, deterministic comparators + `verifyLabel` (claimed comparison) +
  `completeness.ts` (each TTB-required element present / missing / malformed / unverifiable, per
  beverage type) + `thresholds.ts`. Two DISTINCT thresholds, easy to confuse:
  `MIN_READABLE_CONFIDENCE` (0.5 — is the image readable at all → re-upload path) vs
  `FIELD_REVIEW_CONFIDENCE` (0.7 — trust this field's verdict, else downgrade to `review`).
- **`src/app/`** — verify-first single screen (`VerifyForm`: always-visible application form +
  auto-read on upload; results LEAD with the `ResultView` verdict from the pure `verifyLabel`
  comparator, then `CompletenessView`, then `ExtractedFieldsView`; thumbnails open the accessible
  `ImageLightbox`; a non-blocking `ForwardLookingNote` lists 2025 proposals) + `/api/verify` route +
  `/batch`; `src/app/ui/` holds shared primitives. **`eval/`** — the harness and filename-keyed
  fixtures (`eval/fixtures/cases.json`).
- **`src/extraction/fieldCatalog.ts`** — THE single source of truth for the extracted field set. One
  ordered descriptor list (`key`/`rawKey`/`confKey`/`label`/`csvColumn`/`group`) that the raw→domain
  mapper (`extractedShape.ts`), the front/back merge (`reconcile.ts`), the field table
  (`ExtractedFieldsView`), and the CSV (`batch/csv.ts`) all derive from — add a field here, not in six
  places. JSON and CSV exports therefore cover the same fields.

## Gotchas
- **Reading arbitrary images needs a real provider; the default mock only knows the built-in test
  fixtures.** The mock (default, zero keys) keys off the FILENAME and returns the `extracted` block
  from `eval/fixtures/cases.json` — so it only "reads" those fixture filenames, not arbitrary uploads.
  To read ANY uploaded image, set `VISION_PROVIDER` to a real provider — `openai` (simplest, an OpenAI
  API key) or `llm`/`ocr`/`ensemble` (Azure in-tenant). OpenAI-direct is the live-demo path; Azure is
  the documented production target; the deployed URL runs a real provider. (There is no bundled
  in-app sample picker — that earlier `public/samples/` feature was never built and has been removed.)
- **Uploads are downscaled in the browser first.** `src/app/imageDownscale.ts` shrinks phone photos
  to ~2000px longest edge (JPEG) to fit the latency/token budget. It NEVER throws (falls back to the
  original) and PRESERVES the filename — so the filename-keyed mock still resolves. Don't rename the
  file on that path; tune the cap via `DEFAULT_MAX_EDGE` there.
- **Deployment is Azure, on purpose (in-tenant = the firewall-survival story).** Multi-stage
  `Dockerfile` + Next `output: "standalone"`; ships to Azure App Service or Container Apps. The app
  runs end-to-end in mock mode with ZERO keys. Step-by-step `az` commands live in the README
  ("Deploying to Azure") — the source of truth; don't duplicate them here.
- **The government-warning text is statutory (27 CFR 16.21) and verbatim** — never reword it to pass
  a test. It was re-verified unchanged as of 2026-06 (the 2025 Surgeon General cancer advisory is a
  proposal, not law). It lives once in `src/domain/warning.ts`, guarded by a verbatim unit test.
