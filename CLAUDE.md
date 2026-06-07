# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repository was built autonomously with **Ralph** (`scripts/ralph/`); all 14 stories in
`scripts/ralph/prd.json` are complete (`passes: true`).

**Before doing anything, read `AGENTS.md` at the repo root.** It is the single source of
truth for the architecture, the three compliance checks, the canonical government-warning
text, the latency budget, the thresholds philosophy, and all conventions. Keep this file a
thin pointer to it — don't copy architecture or CFR rules in here, or the two will drift.

- Product/technical context and the "why": `specs/PROJECT_SPEC.md`
- The autonomous build loop prompt (run by `ralph.sh`): `scripts/ralph/CLAUDE.md`
- The task backlog with completion status: `scripts/ralph/prd.json`
- Per-story learnings from the build (gotchas, decisions): `scripts/ralph/progress.txt`

When working interactively (not via the loop), still follow the architecture and non-goals
in `AGENTS.md`: AI extracts, code compares; offline by default; no PII, no auth, no COLA.

## Commands
- `npm run dev` — app at http://localhost:3000 (mock provider, no keys needed)
- `npm test` — full unit + integration suite (Vitest, mock provider, no network)
- `npx vitest run src/compare/text.test.ts` — a single test FILE; add `-t "<name>"` to filter
  by test name. Bare `npx vitest` runs in watch mode.
- `npm run typecheck` / `npm run lint` — strict TypeScript (`tsc --noEmit`) + `eslint .`
  (NOT `next lint` — removed in Next 16; flat config in `eslint.config.mjs`)
- `npm run build` — production build (Next `output: "standalone"`)
- `npm run eval` — per-field precision/recall + latency p50/p95 over `eval/fixtures` (tsx CLI)

`typecheck` → `lint` → `test` is the load-bearing feedback loop that kept the autonomous build
converging; keep all three green before any commit. The suite runs offline on the mock
provider — no keys, no network.

## Architecture as built (where the AGENTS.md pipeline lives)
AGENTS.md describes the `image → VisionProvider(s) → reconciler → comparator → UI` pipeline and
the "why". As built, the load-bearing pieces are:
- **`src/pipeline.ts`** — `runVerification()` is the shared orchestration (reconcile →
  readability gate → compare). BOTH `/api/verify` and the eval harness call it, so the eval
  measures the *exact* production path. Change the verify flow here, not in two places.
- **`src/domain/`** — pre-seeded, CFR-verified, the one hand-written human-trusted module
  (canonical warning, tolerance matrix, proof helper). Treat its constants as statutory:
  extend/integrate, never reword or retune them to make a test pass. See `src/domain/README.md`.
- **`src/extraction/`** — the `VisionProvider` interface + `MockVisionProvider` (default; keys
  off the image FILENAME, not bytes) + `Llm`/`Ocr` Azure providers (env-gated, opt-in) +
  `reconcile.ts` (runs providers in PARALLEL with a per-call ~3s timeout; disagreement → review).
- **`src/compare/`** — pure, deterministic comparators + `verifyLabel` + `thresholds.ts`. Two
  DISTINCT thresholds, easy to confuse: `MIN_READABLE_CONFIDENCE` (0.5 — is the image readable
  at all → re-upload path) vs `FIELD_REVIEW_CONFIDENCE` (0.7 — trust this field's verdict, else
  downgrade to `review`).
- **`src/app/`** — single accessible screen + `/api/verify` route + `/batch`; **`eval/`** — the
  harness and filename-keyed fixtures (`eval/fixtures/cases.json`).

## Gotchas
- **Two CLAUDE.md files.** This one is auto-read by interactive Claude Code;
  `scripts/ralph/CLAUDE.md` is the loop prompt piped into a fresh, headless Claude Code
  instance each iteration. Change loop behavior there, not here.
- **Platform.** Interactive work here is on Windows/PowerShell, but `scripts/ralph/ralph.sh`
  is bash (and the README's `chmod`/`brew install jq` steps assume a Unix-like shell) — run
  the loop under Git Bash/WSL, or use the Bash tool for those commands.
- **The offline demo only recognizes the BUNDLED samples.** Because the mock keys off the
  FILENAME, the one-click sample labels (`public/samples/`) give real verdicts with zero keys,
  but an arbitrary uploaded image can't be read without Azure creds (`VISION_PROVIDER=llm`/`ocr`).
  How the *public* demo should read arbitrary images is the one OPEN DECISION recorded at the
  bottom of `progress.txt` — don't assume it's resolved.
