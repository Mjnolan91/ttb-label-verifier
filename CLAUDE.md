# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repository is built autonomously with **Ralph** (`scripts/ralph/`).

**Before doing anything, read `AGENTS.md` at the repo root.** It is the single source of
truth for the architecture, the three compliance checks, the canonical government-warning
text, the latency budget, the thresholds philosophy, and all conventions. Keep this file a
thin pointer to it — don't copy architecture in here, or the two will drift.

- Product/technical context and the "why": `specs/PROJECT_SPEC.md`
- The autonomous build loop prompt (run by `ralph.sh`): `scripts/ralph/CLAUDE.md`
- The task backlog with completion status: `scripts/ralph/prd.json`
- Learnings from previous loop iterations: `scripts/ralph/progress.txt`

When working interactively (not via the loop), still follow the architecture and non-goals
in `AGENTS.md`: AI extracts, code compares; offline by default; no PII, no auth, no COLA.

## Orient before you assume — the app is built incrementally
Ralph builds the app one story at a time, so the code is whatever has been committed so far:
`src/`, `package.json`, and the npm scripts below exist only after US-001 lands. Check the
real state before assuming a file or script is there:
- `git log --oneline -15` — what's been built
- `scripts/ralph/prd.json` — which stories are `passes: true`
- `scripts/ralph/progress.txt` — what the last iteration learned (and any blockers)

## Commands (available once US-001 has scaffolded `package.json`)
- `npm run dev` — app at http://localhost:3000 (mock provider, no keys needed)
- `npm test` — unit + integration tests (mock provider, no network)
- `npm run typecheck` / `npm run lint` — strict TypeScript + lint
- `npm run build` — production build
- `npm run eval` — per-field precision/recall + latency p50/p95 over `eval/` fixtures

`typecheck` → `lint` → `test` is the load-bearing feedback loop that makes the autonomous
build converge; all three must be green before any commit. The test runner is pinned in
`package.json` once US-001 lands — look there for how to run a single test rather than guessing.

## Gotchas
- **Two CLAUDE.md files.** This one is auto-read by interactive Claude Code;
  `scripts/ralph/CLAUDE.md` is the loop prompt piped into a fresh, headless Claude Code
  instance each iteration. Change loop behavior there, not here.
- **Platform.** Interactive work here is on Windows/PowerShell, but `scripts/ralph/ralph.sh`
  is bash (and the README's `chmod`/`brew install jq` steps assume a Unix-like shell) — run
  the loop under Git Bash/WSL, or use the Bash tool for those commands.
