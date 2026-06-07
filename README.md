# TTB Label Verifier

AI-powered alcohol label verification prototype, built autonomously with
[Ralph](https://github.com/snarktank/ralph) (Ryan Carson; based on
[Geoffrey Huntley's loop pattern](https://ghuntley.com/ralph/)).

It verifies that a label image matches the values claimed in an application across three
TTB checks — brand name, alcohol content, and the government health warning — using an
ensemble-extraction + deterministic-comparison architecture. See `specs/PROJECT_SPEC.md`
for the full spec and `AGENTS.md` for the architecture and conventions.

## How the autonomous build works
Ralph runs Claude Code in a loop. Each iteration is a **fresh** Claude Code instance with
clean context; the only memory between iterations is git history, `scripts/ralph/progress.txt`,
and `scripts/ralph/prd.json`. Each iteration: reads `AGENTS.md` + the backlog, picks the
single highest-priority unfinished story, implements it, runs typecheck/lint/tests (and a
browser check for UI), commits, marks the story done, and appends learnings. When every
story passes it prints `<promise>COMPLETE</promise>` and the loop exits.

## Prerequisites
- Node.js (current LTS) and `npm`
- Claude Code CLI: `npm install -g @anthropic-ai/claude-code` (authenticated)
- `jq` (`brew install jq` on macOS)
- A git repo (run `git init` here if needed) — Ralph commits per story

## Run it
```bash
chmod +x scripts/ralph/ralph.sh

# Start small and WATCH the first run. Args: [--tool claude] [max_iterations]
./scripts/ralph/ralph.sh --tool claude 3

# Once you trust it, let it run further:
./scripts/ralph/ralph.sh --tool claude 20
```
Check progress any time:
```bash
cat scripts/ralph/prd.json | jq '.userStories[] | {id, title, passes}'
cat scripts/ralph/progress.txt
git log --oneline -15
```

## Before you let it loose (read this)
- **Cost / runaway.** The loop runs Claude Code with `--dangerously-skip-permissions` (it
  executes commands without prompting) on a `while`-style loop. Start with a low iteration
  count, watch the first few, and run in a sandbox or container you don't mind it touching.
- **The loop is only as good as the plan.** Quality comes from `prd.json` (right-sized
  stories) and `AGENTS.md` (the architecture + the canonical warning text). Those are
  pre-written here; if you change scope, edit those first.
- **The feedback loop is load-bearing.** The loop converges only because typecheck/lint/tests
  must pass before each commit, and providers mock by default so tests need no network or
  keys. Don't remove those guarantees.
- **Review before you submit.** Treat Ralph's output as a strong first draft, not a finished
  submission. Read the commits, tighten the comparator and the eval, and make sure the app
  stands on its own. Keeping `scripts/ralph/` in the repo is a nice transparency signal
  ("here's how I built it"), but the app should be judged on its own merits.

## Running the app (after the loop has built it)
```bash
npm install
npm run dev        # http://localhost:3000  (mock provider, no keys needed)
npm test           # unit + integration tests
npm run eval       # precision/recall + latency over labeled fixtures
npm run build      # production build
```
Real extraction providers are opt-in via env vars (see `.env.example` once generated);
with no keys set, the app runs end-to-end on the mock provider.

## File map
| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Project bible: architecture, the 3 checks, canonical warning, conventions (auto-read each iteration) |
| `CLAUDE.md` | Short pointer to AGENTS.md (Claude Code auto-read) |
| `specs/PROJECT_SPEC.md` | Product/technical spec; requirements traced to stakeholders |
| `scripts/ralph/ralph.sh` | The loop runner |
| `scripts/ralph/CLAUDE.md` | The loop prompt piped to Claude Code each iteration |
| `scripts/ralph/prd.json` | The task backlog (14 stories) with `passes` status |
| `scripts/ralph/progress.txt` | Append-only learnings across iterations |
