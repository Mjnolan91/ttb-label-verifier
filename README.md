# TTB Label Verifier

AI-powered alcohol label verification prototype, built autonomously with
[Ralph](https://github.com/snarktank/ralph) (Ryan Carson; based on
[Geoffrey Huntley's loop pattern](https://ghuntley.com/ralph/)).

It verifies that a label image matches the values claimed in an application across three
TTB checks — brand name, alcohol content, and the government health warning — using an
ensemble-extraction + deterministic-comparison architecture. See `specs/PROJECT_SPEC.md`
for the full spec and `AGENTS.md` for the architecture and conventions.

> **Runs with zero keys.** The app and the *entire* test suite run offline on a mock
> provider — `npm install && npm run dev`, no API keys, no network. Real Azure extractors
> are opt-in via environment variables only. See [Trade-offs & limitations](#trade-offs--limitations)
> and [Deploying to Azure](#deploying-to-azure).

## Design decisions → stakeholder needs
Every major choice traces back to a specific person from the discovery interviews, so the
"why" is never lost. (Full requirement list with citations in `specs/PROJECT_SPEC.md`.)

| Stakeholder (role) | Their need | Design decision |
| --- | --- | --- |
| **Sarah** — supervising agent; her team is 50+, including a **73-year-old** reviewer; handles **batches of 200–300** at peak | A prior scanner took 30–40s/label and was abandoned — **speed is the #1 adoption gate**; the screen must be usable without hunting; big batches can't be processed one at a time | **~5s latency ceiling**: when two extractors run they run in **parallel** with a per-call **~3s timeout** (`Promise.allSettled` + `AbortController`), reconciling whatever returned instead of blocking on a straggler (US-010). **Accessibility-first single screen** targeting WCAG 2.1 AA — ≥4.5:1 contrast, ≥44×44px targets, visible non-color-only focus, full keyboard order, programmatic labels (US-006/007). **Batch upload + results table + CSV export** with progressive results (US-013, stretch). |
| **Marcus** — IT | The **outbound firewall blocks many domains and killed the last vendor's external ML endpoints**; the prototype must stay standalone with **no PII** and deploy to **Azure** | Extraction sits behind a swappable **`VisionProvider`** interface, and the real providers are **Azure-native / in-tenant** — `llm` → **Azure OpenAI** (multimodal), `ocr` → **Azure AI Document Intelligence** (OCR). Running extraction *inside the Azure tenant* is the firewall-survival story: it isn't an external endpoint the outbound firewall blocks. **No auth, no PII persisted, no COLA** integration. **Deploy target is Azure** (App Service or Container Apps), and the app still runs fully in mock mode with **zero keys** (US-009/010/014). |
| **Dave** — 28-year agent | Obvious-equivalent brand strings keep getting flagged — `STONE'S THROW` vs `Stone's Throw` is plainly the same product | **Fuzzy brand check**: normalize case, whitespace, punctuation, and smart quotes (U+2019), then compare. Exact-after-normalization = **pass**; high similarity = **review** (shows the discrepancy); low = **fail** (US-004). |
| **Jenny** — junior agent | The warning must match **word-for-word**; `GOVERNMENT WARNING:` must be **caps and bold**; a title-case prefix should be **rejected** | **Strict warning check** against the verbatim statutory text (27 CFR Part 16), reading the extractor's `warningPrefixIsAllCaps` / `warningPrefixIsBold` flags rather than re-deriving format from raw text. Title-case (`Government Warning`), reworded, or missing = **fail**. Bold is tri-state: undetectable (`null`) is treated as "cannot assert," not a violation (US-004). Bad photos fail **gracefully** with a re-upload prompt instead of asserting a verdict (US-008). |

The unifying thesis (see `AGENTS.md` and `specs/PROJECT_SPEC.md`): be **superhuman on the
axes where machines win** — consistency, throughput, tireless recall of routine checks —
while **routing ambiguity to a human**. Thresholds are **asymmetric**: the system optimizes
to minimize **false approvals**, preferring an unnecessary review to a missed violation. The
`eval/` harness proves this with numbers (per-field precision/recall + latency p50/p95) and
**fails CI if approve-precision drops below 0.98** (US-012).

## Trade-offs & limitations
Honest accounting of the choices and what they cost:

- **Mock provider is the default, by design.** The app and the entire test suite run with
  **no network and no API keys**. This keeps the build hermetic, deterministic, and CI-safe,
  but it means out-of-the-box runs exercise the *pipeline and verdict logic*, not a real
  model's reading accuracy. Real extraction is opt-in via `VISION_PROVIDER=llm|ocr` + Azure
  env vars. **Trade-off:** reviewers see the deterministic comparator working end-to-end
  immediately; judging real OCR/vision accuracy requires supplying Azure credentials.
- **Test fixtures are hermetic and key off the image *filename*, not pixels.** The mock
  returns a fixture's extracted fields based on its filename, so the offline suite needs **no
  real images** (`eval/fixtures/cases.json` is the labeled manifest). The seven defect/edge-case
  fixtures stay lightweight **`.svg` placeholders** (their pixels are never read); the **demo
  sample labels are real rasters** — `abc-single-barrel-clean.jpg` plus three generated
  `demo-*.png` (clean / title-case / brand-typo) wired to the home-screen sample buttons, so the
  live `llm` demo extracts genuine pixels. Their filenames stay in lockstep with `cases.json`, so
  they also yield the right verdict offline (regenerate with `node scripts/generate-demo-labels.cjs`).
  **Trade-off:** to exercise a real provider on the *other* scenarios (smart-quote brand,
  out-of-tolerance ABV, missing warning, unreadable), drop real images at the exact paths in
  `eval/fixtures/images/MANIFEST.md`; the offline test + eval suite passes without them.
- **Azure is the chosen cloud, not a multi-cloud abstraction.** The reference providers and
  deploy steps are Azure-specific *on purpose* — it's the in-tenant answer to Marcus's
  outbound-firewall constraint. The `VisionProvider` interface itself stays generic, so a
  different backend (AWS Textract, GCP Vision, a local OCR engine) could be added later, but
  only Azure is implemented and documented here. **Trade-off:** tight fit to the stated
  firewall problem at the cost of portability work that wasn't in scope.
- **Domain tolerances encode the full beverage matrix, with a couple of items flagged.** The
  alcohol check selects its CFR tolerance from the beverage class — distilled spirits ±0.3pp
  (27 CFR 5.65(c)); wine ≤14% ±1.5pp and wine >14% ±1.0pp (27 CFR 4.36(b)(1), with the
  4.36(c) 14% tax-class boundary recorded as a clamp, not folded into the number); malt
  beverages/beer ±0.3pp (27 CFR 7.65, with the 0.5% floor and 2.5% low/reduced-alcohol cap
  noted). Two resolutions are **flagged "VERIFY before production"** in `src/domain/`:
  - **Cider** has no standalone tolerance — it's classified by *production method*. We default
    it to **wine ≤14% (±1.5pp)** (the common apple/pear fruit-cider case); malt-based ciders
    should be classified `maltBeverage` upstream. The 8.5% ABV figure for cider is a
    hard-cider **tax-rate** boundary, *not* a labeling tolerance, and is intentionally not
    encoded.
  - **`unknown` class** falls back to the **tightest band (±0.3pp)** as a conservative
    *product* default (not a CFR value) to avoid false approvals; unknown-class labels are
    better routed to human review.
  - The asymmetric **boundary constraints** (wine 14% clamp; malt 0.5%/2.5% limits) currently
    travel as documented metadata on each tolerance rule; **enforcing** them is the
    comparator's job (US-004). The CFR tolerance *values* were web-verified against eCFR /
    Cornell LII; some TTB.gov *guidance* pages (cider classification) were corroborated via
    search summaries.
- **The government-warning text is statutory and verbatim.** It is **never reworded** to make
  a check pass; it lives once in `src/domain/warning.ts`, validated byte-for-byte against the
  canonical text in `AGENTS.md`.
- **Scope is deliberately narrow.** No COLA integration, no auth, no PII storage, and no image
  deskewing/glare correction — bad photos are handled by asking for a re-upload, not by
  trying to out-read a human on a glare-y image.

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

### Enabling real (Azure-native) extraction — optional
The default `mock` provider needs nothing. To switch to a real, **in-tenant** extractor, set
`VISION_PROVIDER` and the matching Azure vars (these live in `.env.example`; never commit real
secrets):

```bash
# Option A — fast multimodal model: Azure OpenAI (US-009)
VISION_PROVIDER=llm
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=<your-vision-capable-deployment>
# AZURE_OPENAI_API_VERSION=2024-06-01   # optional

# Option B — dedicated OCR: Azure AI Document Intelligence (US-010)
VISION_PROVIDER=ocr
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://<your-resource>.cognitiveservices.azure.com
AZURE_DOCUMENT_INTELLIGENCE_KEY=<key>

# Option C — OpenAI API directly (simplest; no Azure resource or quota approval needed)
VISION_PROVIDER=openai
OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4o   # optional (default; gpt-4o-mini also works)
```

> **Why an OpenAI option exists.** Azure OpenAI is the in-tenant production target (it's the
> firewall-survival story). But Azure access is sometimes gated by per-region/per-subscription
> quota approvals that can block a quick demo. Because extraction sits behind the generic
> `VisionProvider` interface, adding an OpenAI-direct provider (`src/extraction/OpenAIVisionProvider.ts`)
> was a small, self-contained change that reuses the exact same prompt and JSON parsing — a concrete
> payoff of the "AI extracts, code compares" abstraction. The live demo can run on whichever the
> author has access to; the Azure path stays documented and implemented for production.

If a selected provider's required vars are unset, the request **fails loud** with an actionable
message (a clear 500) — it never silently falls back to the mock and pretends to read the image.
The absence of Azure keys never affects the default (mock) dev/test path. Running both extractors
reconciles them in parallel within the budget (US-010).

**What changes once `llm` is configured (e.g. on the deployed demo):**
- **Arbitrary uploads are read for real.** Any photo a reviewer uploads goes to Azure OpenAI and
  is transcribed by the model — not matched against a fixture. A genuinely unreadable photo gets a
  "re-upload a clearer photo" prompt (never a fabricated verdict).
- **The one-click sample buttons send real raster labels.** `public/samples/demo-*.png` are real,
  legible labels (regenerate with `node scripts/generate-demo-labels.cjs`), so the samples
  demonstrate genuine extraction — not just the offline mock. Their filenames stay in lockstep with
  `eval/fixtures/cases.json`, so they also produce the right verdict offline.
- **Large photos are downscaled in the browser** (longest edge ~1400px, JPEG) before upload to cut
  latency, tokens, and cost — falling back to the original on any failure (`src/app/imageDownscale.ts`).
- **Tune the per-call timeout** with `VISION_TIMEOUT_MS` (default ~8s for real providers; see
  `.env.example`).

## Evaluation: measuring "better than human"
`npm run eval` runs the full pipeline (mock provider, **offline**) over the labeled fixtures in
`eval/fixtures/cases.json` and prints a report:

```text
Per-field precision / recall (support = # expected):
  field    status   precision   recall   support
  brand    pass       100.0%   100.0%     8
  brand    review     100.0%   100.0%     3
  alcohol  pass       100.0%   100.0%     9
  alcohol  fail       100.0%   100.0%     1
  warning  pass       100.0%   100.0%     7
  warning  fail       100.0%   100.0%     3
  ...
Overall verdict precision / recall:
  verdict   precision   recall   support
  approve    100.0%   100.0%     4
  review     100.0%   100.0%     3
  reject     100.0%   100.0%     4

Overall accuracy: 100.0%  (11 cases)
Latency: p50 0.1 ms, p95 0.8 ms

APPROVE precision: 100.0% (floor 98.0%) -> PASS
```

**How to read it:**
- **Per-field precision/recall** — for each check (brand / alcohol / warning) and each status
  (`pass` / `review` / `fail`): *precision* = of the times we predicted this status, how often
  it was correct; *recall* = of the fixtures that truly had this status, how many we caught;
  *support* = how many fixtures carry that expected status (`—` = none present, so the metric is
  N/A).
- **Overall verdict precision/recall** — the same, for the end-to-end verdict (`approve` /
  `review` / `reject`).
- **Latency p50 / p95** — median and 95th-percentile time per label. The hard requirement is a
  ~5s ceiling; the offline mock path shown here is sub-millisecond, so **these numbers measure
  the pipeline, not a real model**. Real Azure-vision calls typically return in ~1–4s; large
  uploads are downscaled client-side (~1400px longest edge) to help, and a per-call straggler cap
  (default ~8s, override with `VISION_TIMEOUT_MS`) keeps a hang from blocking the verdict. Capture
  real p50/p95 from a keyed deployment (e.g. the browser Network panel over the sample labels).
- **APPROVE precision + floor** — the headline metric. Because a **false approval is far worse
  than an unnecessary review**, the harness enforces a floor: **approve-precision must be
  ≥ 0.98**, or `npm run eval` exits non-zero (failing CI). The floor is the named, documented
  constant `APPROVE_PRECISION_FLOOR` in `eval/evaluate.ts`. The labeled set deliberately mixes
  clean labels with broken ones (title-case warning, ABV off by a point, brand typo, missing
  warning) and an unreadable image that must **never** auto-approve.

## Deploying to Azure
Azure is the deploy target on purpose: the real extractors run **inside the Azure tenant**, so
they survive the outbound firewall that blocked the previous vendor (Marcus's constraint). The
app still runs **end-to-end in mock mode with zero keys**, so you can deploy first and add
Azure extraction later. Pick **one** of the two paths below. Both assume the
[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) is installed and you've
run `az login`.

```bash
# Shared: a resource group (one-time)
az group create --name ttb-label-verifier-rg --location eastus
```

**Path A — Azure App Service (simplest):**
```bash
# Build, then deploy the Node app straight from this directory.
npm install && npm run build

az webapp up \
  --name ttb-label-verifier \
  --resource-group ttb-label-verifier-rg \
  --runtime "NODE:20-lts" \
  --sku B1

# (optional) enable real extraction by setting env vars on the running app:
az webapp config appsettings set \
  --name ttb-label-verifier \
  --resource-group ttb-label-verifier-rg \
  --settings VISION_PROVIDER=llm \
             AZURE_OPENAI_ENDPOINT="https://<res>.openai.azure.com" \
             AZURE_OPENAI_API_KEY="<key>" \
             AZURE_OPENAI_DEPLOYMENT="<deployment>"
# → public URL: https://ttb-label-verifier.azurewebsites.net
```

**Path B — Azure Container Apps (containerized):**
```bash
# Build and push the image to Azure Container Registry, then deploy it.
az acr create --resource-group ttb-label-verifier-rg --name ttblabelverifieracr --sku Basic
az acr build --registry ttblabelverifieracr --image ttb-label-verifier:latest .

az containerapp up \
  --name ttb-label-verifier \
  --resource-group ttb-label-verifier-rg \
  --image ttblabelverifieracr.azurecr.io/ttb-label-verifier:latest \
  --target-port 3000 \
  --ingress external

# (optional) set env vars for real extraction (mock is the default if you skip this):
az containerapp update \
  --name ttb-label-verifier \
  --resource-group ttb-label-verifier-rg \
  --set-env-vars VISION_PROVIDER=ocr \
                 AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://<res>.cognitiveservices.azure.com" \
                 AZURE_DOCUMENT_INTELLIGENCE_KEY="<key>"
```

**Configuration.** The repo ships a [`Dockerfile`](./Dockerfile) (multi-stage, Next.js
`output: "standalone"`) used by the Container Apps path, and an [`.env.example`](./.env.example)
documenting **every** environment variable. **All are optional** — with **none** set, the deployed
app serves the full UI end-to-end on the **mock** provider (no keys, no external ML calls). Set
`VISION_PROVIDER` + the matching Azure vars only for real, in-tenant extraction. The runtime/SKU
names above are starting points; adjust to your subscription.

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
