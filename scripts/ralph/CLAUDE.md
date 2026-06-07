# Ralph Loop Prompt — TTB Label Verifier (Claude Code)

You are running as ONE iteration of an autonomous build loop. Each iteration begins
with a FRESH context: you remember nothing from prior iterations except what is written
in git history, `scripts/ralph/progress.txt`, `scripts/ralph/prd.json`, and `AGENTS.md`.
Work accordingly — leave good notes for the next iteration, because that is future-you.

## Step 0 — Orient (always, every iteration)
1. Read `AGENTS.md` at the repo root in full. It is the source of truth for the
   architecture, the three compliance checks, the canonical government-warning text,
   the 5-second latency budget, the thresholds philosophy, and all conventions.
   Do not deviate from it.
2. Skim `specs/PROJECT_SPEC.md` for product context and the "why".
3. Read `scripts/ralph/progress.txt` for learnings from previous iterations.
4. Run `git log --oneline -15` to see what has already been built.

## Step 1 — Pick exactly ONE story
- Read `scripts/ralph/prd.json`.
- Select the story with the LOWEST `priority` number where `passes` is `false`.
- If EVERY story already has `passes: true`, output exactly `<promise>COMPLETE</promise>`
  and STOP. Do nothing else.
- State the story id and title you are about to implement.

## Step 2 — Branch (first iteration only)
- The working branch is the `branchName` in `prd.json`. If you are not on it, create or
  switch to it. If it already exists, stay on it. Never commit to `main`.

## Step 3 — Implement that one story, and ONLY that story
- Make the smallest correct change that satisfies ALL of the story's `acceptanceCriteria`.
- Do NOT start, scaffold, or "get a head start on" any other story. One story per iteration.
- Honor every convention in `AGENTS.md`. In particular:
  - **AI extracts, code compares.** All image reading goes through the `VisionProvider`
    interface. All match/verdict logic is pure, deterministic, and unit-tested — never
    delegated to a model.
  - **Offline by default.** Extraction must default to the mock/fixture provider so the
    app and the entire test suite run with NO network and NO API keys. Real providers are
    selected only via environment variables.
  - Never weaken, skip, or delete a test to make checks pass. Never edit the canonical
    government-warning constant to make a test pass.

## Step 4 — Verify (the feedback loop — this is what makes the loop converge)
Run these and make them ALL green before committing:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- If the story's criteria include "Verify in browser", use the dev-browser skill to load
  the page, exercise the UI, and confirm the behavior genuinely works.
If a check fails, fix it. If you are truly blocked, write the blocker into the story's
`notes` field in `prd.json` and into `progress.txt`, do NOT mark the story passing, and stop.

## Step 5 — Record and commit (only when all checks are green)
1. Set that story's `passes` to `true` in `scripts/ralph/prd.json`. Touch nothing else in that file.
2. Append a 2–4 line entry to `scripts/ralph/progress.txt`: what you built, any gotcha,
   and anything the next iteration must know.
3. If you discovered a durable pattern, convention, or gotcha, add it to the
   "Learnings" section at the bottom of `AGENTS.md`.
4. Commit everything: `git add -A && git commit -m "US-00X: <story title>"`.
5. Stop. The loop will start the next iteration with a clean context.

## Standing rules
- One story per iteration. Small, correct, tested, committed.
- Keep CI green. Broken code compounds across iterations and wastes the whole run.
- Prefer the simplest implementation that meets the criteria. This is a time-boxed
  prototype, not a platform.
- Do NOT add authentication, persist PII, or integrate with COLA. See non-goals in `AGENTS.md`.
- Only when ALL stories pass: output `<promise>COMPLETE</promise>`.
