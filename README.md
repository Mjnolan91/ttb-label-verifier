# TTB Label Verifier

An AI-powered prototype that **reads U.S. alcohol-beverage label images into the full set of
TTB-required fields** and **checks the label for completeness** against TTB's mandatory-information
requirements for its beverage type — then, **optionally**, verifies the label against an
application's claimed values (the three core checks: **brand name**, **alcohol content**, and the
**government health warning**).

The product reads a product's label image(s) — front, back, neck — *together* into one structured
record: brand, class/type, alcohol content, net contents, name & address, country of origin, the
government warning, plus wine (appellation, vintage, varietal, sulfite declaration) and spirits (age
statement) elements. It then flags each TTB-required element as **present / missing / malformed /
unverifiable** for the detected beverage type, and exports the result as **JSON or CSV** — no typing.
When an agent enters the application's brand and alcohol content, the deterministic comparator
produces an at-a-glance **Approve / Needs review / Reject** verdict for the three statutory checks.

**Live demo:** https://ttb-label-verifier-matthew-nolan-s-projects.vercel.app — hosted on Vercel,
auto-deployed from `main`.

> **Runs with zero keys.** The app and the *entire* test suite run offline on a mock
> provider — `npm install && npm run dev`, no API keys, no network. Real extractors (Gemini- or
> OpenAI-direct for the hosted demo, Azure OpenAI / Azure AI Document Intelligence for in-tenant
> production) are opt-in via environment variables only. See [Enabling real extraction](#enabling-real-azure-native-extraction--optional)
> and [Deploying](#deploying).

## Run it
```bash
npm install
npm run dev        # http://localhost:3000  (mock provider, no keys needed)
npm test           # unit + integration + component tests (offline)
npm run eval       # per-field precision/recall + latency over labeled fixtures (CI gate)
npm run build      # production build (Next standalone)
```
On the home screen, enter the application's brand name and alcohol content, drop the product's label
image(s), and the screen leads with the Approve / Needs-review / Reject verdict (with the full read +
completeness check below). **In the default offline mock mode the reader only recognizes the bundled
test fixtures** (it keys off the filename), so to read your *own* photos set a real provider — see
[Enabling real extraction](#enabling-real-azure-native-extraction--optional) — or use the deployed URL,
which runs a real provider.

## What it does
- **Verification against an application (the core check, front-and-center).** Enter the application's
  brand name and alcohol content (and optionally class/type), drop the label image(s), and the screen
  leads with a deterministic Approve / Needs-review / Reject verdict over the three checks the brief
  calls out:
  fuzzy brand match, ABV tolerance by beverage class, and strict government-warning matching — reduced
  to an overall **Approve / Needs review / Reject** verdict. This runs entirely in pure, auditable code.
- **Full extraction + completeness (the supporting layer).** The AI also reads the *entire* TTB field
  set off the image(s) — killing the manual data entry stakeholders complained about — and the app
  checks completeness against the mandatory elements for the detected beverage class (distilled spirits
  / wine ≤14% / wine >14% / malt beverage / cider). Each element is flagged present / missing /
  malformed / not-applicable with the governing CFR note. Download the whole record as JSON or CSV.
- **Batch.** Upload many products at once; front/back images pair by filename, results stream into a
  table with CSV export ([`/batch`](src/app/batch/page.tsx)).

## Design decisions → stakeholder needs
Every major choice traces back to a specific person from the discovery interviews, so the
"why" is never lost. (Full requirement list with citations in `specs/PROJECT_SPEC.md`.)

| Stakeholder (role) | Their need | Design decision |
| --- | --- | --- |
| **Sarah** — supervising agent; her team is 50+, including a **73-year-old** reviewer; handles **batches of 200–300** at peak | A prior scanner took 30–40s/label and was abandoned — **speed is the #1 adoption gate**; the screen must be usable without hunting; big batches can't be processed one at a time | **~5s latency ceiling**: when two extractors run they run in **parallel** with a per-call **~3s/8s timeout** (`Promise.allSettled` + `AbortController`), reconciling whatever returned instead of blocking on a straggler. **Accessibility-first single screen** targeting WCAG 2.1 AA — ≥4.5:1 contrast, ≥44×44px targets, visible non-color-only focus, full keyboard order, skip link, programmatic labels. **Batch upload + results table + CSV export** with progressive results. |
| **Marcus** — IT | The **outbound firewall blocks many domains and killed the last vendor's external ML endpoints**; the prototype must stay standalone with **no PII** and deploy to **Azure** | Extraction sits behind a swappable **`VisionProvider`** interface, and the real providers are **Azure-native / in-tenant** — `llm` → **Azure OpenAI** (multimodal), `ocr` → **Azure AI Document Intelligence** (OCR). Running extraction *inside the Azure tenant* is the firewall-survival story. **No auth, no PII persisted, no COLA** integration. **Deploy target is Azure** (App Service or Container Apps), and the app still runs fully in mock mode with **zero keys**. |
| **Dave** — 28-year agent | Obvious-equivalent brand strings keep getting flagged — `STONE'S THROW` vs `Stone's Throw` is plainly the same product | **Fuzzy brand check**: normalize case, whitespace, punctuation, and smart quotes (U+2019), then compare. Exact-after-normalization = **pass**; high similarity = **review** (shows the discrepancy); low = **fail**. |
| **Jenny** — junior agent | The warning must match **word-for-word**; `GOVERNMENT WARNING:` must be **caps and bold**; a title-case prefix should be **rejected** | **Strict warning check** against the verbatim statutory text (27 CFR 16.21), reading the extractor's `warningPrefixIsAllCaps` / `warningPrefixIsBold` flags rather than re-deriving format from raw text. Title-case (`Government Warning`), reworded, or missing = **fail**. Bold is tri-state: undetectable (`null`) is "cannot assert," not a violation. Bad photos fail **gracefully** with a re-upload prompt. |

The unifying thesis (see `AGENTS.md` and `specs/PROJECT_SPEC.md`): be **superhuman on the
axes where machines win** — consistency, throughput, tireless recall of routine checks —
while **routing ambiguity to a human**. Thresholds are **asymmetric**: the system optimizes
to minimize **false approvals**, preferring an unnecessary review to a missed violation. The
`eval/` harness proves this with numbers (per-field precision/recall + latency p50/p95) and
**fails CI if approve-precision drops below 0.98**.

## How the extraction works ("AI extracts, code compares")
```
image ──> [ VisionProvider(s) ] ──> [ reconciler ] ──> [ completeness + optional comparator ] ──> UI
            (probabilistic)          (agree/disagree)    (pure, auditable, tested)
```
- **Extraction is probabilistic** and lives behind the `VisionProvider` interface, with per-field
  confidence. Providers: `mock` (default, offline), `openai` (OpenAI-direct), `gemini` (Google
  Gemini), `llm` (Azure OpenAI), `ocr` (Azure AI Document Intelligence), and `ensemble` (llm + ocr
  reconciled). Adding `gemini` was a ~150-line drop-in behind the interface — a concrete payoff of the
  swappable-provider design (and handy for comparing how a different model reads subtle cues like the
  warning's bold/all-caps flags).
- **The real providers use current, cutting-edge practice.** They request **strict structured
  outputs** (`response_format: json_schema`, `strict: true`) so the model is constrained to the exact
  field shape — not free-text JSON. The default model is a current multimodal model (`gpt-4.1`,
  overridable; `gpt-4.1-mini` is a cheaper/faster option that beats GPT-4o on image benchmarks).
  Requests carry **bounded retry** on transient 429/5xx (honoring `Retry-After`), a **self-limiting
  timeout**, and explicit truncation handling — so a single hiccup doesn't fail a read.
- **Reconciliation** (when two providers run): fields where providers agree → high confidence; fields
  where they genuinely disagree → flagged `review`. Agreement is tolerant of punctuation/spacing and
  one-character OCR noise (`750 mL` vs `750ml`), so benign formatting differences aren't over-routed
  to review. Disagreement is a feature, not a bug — it routes uncertainty to a human.
- **Comparison and completeness are deterministic.** All pass/fail/review logic is pure,
  side-effect-free, and unit-tested. A model never makes the final compliance verdict — in a
  government context, the answer to "why was this rejected?" must be rules-based and reproducible.

The CFR-grounded rules (the canonical warning text, the per-class ABV tolerance matrix, the
mandatory-element matrix, the 0.5% warning exemption) live once in `src/domain/`, hand-written and
verified against the current eCFR. See `src/domain/README.md` and `AGENTS.md` for the full rule set.

## Evaluation: measuring "better than human"
`npm run eval` runs the full pipeline (mock provider, **offline**) over the labeled fixtures in
`eval/fixtures/cases.json` and prints per-field precision/recall, overall verdict precision/recall,
and latency p50/p95. Because a **false approval is far worse than an unnecessary review**, the harness
enforces a floor: **approve-precision must be ≥ 0.98** (the named constant `APPROVE_PRECISION_FLOOR`
in `eval/evaluate.ts`), or `npm run eval` exits non-zero (failing CI). The labeled set deliberately
mixes clean labels with broken ones (title-case warning, ABV off by a point, brand typo, missing
warning) and an unreadable image that must **never** auto-approve.

The offline-mock latency shown is sub-millisecond — it measures the *pipeline*, not a real model.
Real Azure-vision calls typically return in ~1–4s; large uploads are downscaled client-side
(~2000px longest edge) and a per-call straggler cap (default ~8s, override with `VISION_TIMEOUT_MS`)
keeps a hang from blocking the verdict. Capture real p50/p95 from a keyed deployment.

## Trade-offs & limitations
Honest accounting of the choices and what they cost:

- **Mock provider is the default, by design.** The app and the entire test suite run with **no
  network and no API keys**, which keeps the build hermetic, deterministic, and CI-safe — but
  out-of-the-box runs exercise the *pipeline and verdict logic*, not a real model's reading accuracy.
  Real extraction is opt-in. Reviewers see the deterministic logic working end-to-end immediately;
  judging real OCR/vision accuracy requires supplying a key.
- **One build-time network dependency: the web font.** `npm test`, `npm run dev`, and the running
  app are fully offline, but `next/font/google` fetches the **Inter** font once during `npm run build`
  (then caches it). On Vercel and any CI/Azure pipeline with build-time internet this is a non-issue;
  for a strictly air-gapped in-tenant build, swap `next/font/google` for `next/font/local` with a
  self-hosted Inter file. Left as a documented caveat rather than committing font binaries to the repo.
- **Test fixtures are hermetic and key off the image *filename*, not pixels.** The defect/edge-case
  fixtures stay lightweight `.svg` placeholders (their pixels are never read); a few demo rasters in
  `eval/fixtures/images/` are real images, so a live provider extracts genuine pixels from them. Their
  filenames stay in lockstep with `cases.json`, so they also yield the right verdict offline
  (regenerate with `node scripts/generate-demo-labels.cjs`). To exercise a real provider on the *other*
  scenarios, drop real images at the paths in `eval/fixtures/images/MANIFEST.md`.
- **Verification is front-and-center; extraction is the supporting layer.** The screen leads with the
  claimed-vs-application verdict (the brief's "read the label, check it matches the application"
  workflow), and the full extraction + TTB completeness check render beneath it. The verdict appears
  as soon as application values are supplied; with none on hand, the completeness summary is the
  headline — so the tool is useful either way.
- **Azure is the chosen cloud, not a multi-cloud abstraction.** The reference providers and deploy
  steps are Azure-specific *on purpose* — it's the in-tenant answer to Marcus's outbound-firewall
  constraint. The `VisionProvider` interface stays generic, so a different backend could be added
  later, but only Azure (plus OpenAI-direct for the demo) is implemented here.
- **Domain tolerances encode the full beverage matrix, verified against the current CFR.** The
  alcohol check selects its CFR tolerance from the beverage class — distilled spirits ±0.3pp
  (27 CFR 5.65(c)); wine ≤14% ±1.5pp / wine >14% ±1.0pp (27 CFR 4.36(b)(1), with the 4.36(c) 14%
  tax-class boundary as a clamp); malt beverages ±0.3pp (27 CFR 7.65(c), with the 0.5% floor and the
  2.5% low/reduced cap at 7.65(d)). Alcohol-content *requirement* is per class: mandatory for spirits
  and wine >14%, but **optional for malt beverages** by default (27 CFR 7.63(a)(3)) and satisfiable on
  wine ≤14% by a "table wine"/"light wine" designation (27 CFR 4.36(a)). Two resolutions are flagged
  **"VERIFY before production"** in `src/domain/`: cider's wine-vs-malt classification (by production
  method; the 8.5% figure is a *tax-rate* boundary, not a labeling tolerance) and the `unknown`-class
  default band. The renumbering reflects TTB's 2022 modernization (T.D. TTB-176, eff. Mar 11, 2022);
  Part 4 (wine) was not renumbered.
- **The government-warning text is statutory and verbatim.** It is **never reworded** to make a check
  pass; it lives once in `src/domain/warning.ts`, validated byte-for-byte against 27 CFR 16.21. It was
  re-verified **unchanged as of 2026-06**. The Surgeon General's January 2025 advisory on alcohol and
  cancer risk has prompted calls to add a cancer warning, but the ABLA statute can be amended only by
  Congress and no rule has changed the text — the verbatim-comparison design would absorb a future
  change by editing that single canonical constant.
- **Scope is deliberately narrow.** No COLA integration, no auth, no PII storage, and no image
  deskewing/glare correction — bad photos are handled by asking for a re-upload, not by trying to
  out-read a human on a glare-y image. Physical type-size checks (27 CFR 16.22(b) mm minimums) are out
  of automated scope — they can't be measured from extracted text.

## Enabling real (Azure-native) extraction — optional
The default `mock` provider needs nothing. To switch to a real extractor, set `VISION_PROVIDER` and
the matching vars (documented in [`.env.example`](.env.example); never commit real secrets):

```bash
# Option A — OpenAI API directly (simplest; no Azure resource or quota approval needed)
VISION_PROVIDER=openai
OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4.1          # optional (default; gpt-4.1-mini is cheaper/faster)

# Option A2 — Google Gemini directly (also no Azure resource; key from aistudio.google.com/apikey)
VISION_PROVIDER=gemini
GEMINI_API_KEY=...             # or GOOGLE_API_KEY
# GEMINI_MODEL=gemini-3.5-flash  # optional (default; a -pro model may read subtle cues better)

# Option B — Azure OpenAI (the in-tenant production target)
VISION_PROVIDER=llm
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=<your-vision-capable-deployment>

# Option C — Azure AI Document Intelligence (dedicated OCR)
VISION_PROVIDER=ocr
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://<your-resource>.cognitiveservices.azure.com
AZURE_DOCUMENT_INTELLIGENCE_KEY=<key>

# Option D — ensemble: run llm + ocr in parallel and reconcile disagreements (needs BOTH sets)
VISION_PROVIDER=ensemble
```

> **Why an OpenAI-direct option exists.** Azure OpenAI is the in-tenant production target (the
> firewall-survival story), but Azure access is sometimes gated by per-region/per-subscription quota
> approvals that can block a quick demo. Because extraction sits behind the generic `VisionProvider`
> interface, adding an OpenAI-direct provider reuses the exact same prompt, schema, and parsing — a
> concrete payoff of the "AI extracts, code compares" abstraction.

If a selected provider's required vars are unset, the request **fails loud** with an actionable 500 —
it never silently falls back to the mock and pretends to read the image. Tune the per-call timeout
with `VISION_TIMEOUT_MS` (default ~8s for real providers).

## Deploying
**Live demo — Vercel.** The public demo is hosted on **Vercel**, which auto-builds and redeploys on
every push to `main` (zero config — Vercel detects Next.js). Set `VISION_PROVIDER` + the provider key
(e.g. `gemini` / `GEMINI_API_KEY`) in the project's **Settings → Environment Variables (Production)**
so the hosted app reads real uploads; with none set it runs in mock mode. Production URL:
**https://ttb-label-verifier-matthew-nolan-s-projects.vercel.app**

**Azure — the in-tenant production target.** Azure is the documented production path on purpose: the
real extractors run **inside the Azure tenant**, so they survive the outbound firewall that blocked
the previous vendor (Marcus's constraint). The app still runs **end-to-end in mock mode with zero
keys**, so you can deploy first and add Azure extraction later. Both Azure paths assume the
[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) is installed and you've run `az login`.

```bash
# Shared: a resource group (one-time)
az group create --name ttb-label-verifier-rg --location eastus
```

**Path A — Azure App Service (simplest):**
```bash
npm install && npm run build
az webapp up \
  --name ttb-label-verifier \
  --resource-group ttb-label-verifier-rg \
  --runtime "NODE:20-lts" \
  --sku B1
# (optional) enable real extraction by setting env vars on the running app:
az webapp config appsettings set \
  --name ttb-label-verifier --resource-group ttb-label-verifier-rg \
  --settings VISION_PROVIDER=llm \
             AZURE_OPENAI_ENDPOINT="https://<res>.openai.azure.com" \
             AZURE_OPENAI_API_KEY="<key>" \
             AZURE_OPENAI_DEPLOYMENT="<deployment>"
# → public URL: https://ttb-label-verifier.azurewebsites.net
```

**Path B — Azure Container Apps (containerized):**
```bash
az acr create --resource-group ttb-label-verifier-rg --name ttblabelverifieracr --sku Basic
az acr build --registry ttblabelverifieracr --image ttb-label-verifier:latest .
az containerapp up \
  --name ttb-label-verifier \
  --resource-group ttb-label-verifier-rg \
  --image ttblabelverifieracr.azurecr.io/ttb-label-verifier:latest \
  --target-port 3000 --ingress external
```

**Configuration.** The repo ships a [`Dockerfile`](./Dockerfile) (multi-stage, Next.js
`output: "standalone"`) used by the Container Apps path, and an [`.env.example`](./.env.example)
documenting **every** environment variable. **All are optional** — with **none** set, the deployed
app serves the full UI end-to-end on the **mock** provider (no keys, no external ML calls).

## Project layout
| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Architecture, the 3 checks, canonical warning, conventions (the project bible) |
| `CLAUDE.md` | Short pointer to AGENTS.md for AI coding tools |
| `specs/PROJECT_SPEC.md` | Product/technical spec; requirements traced to stakeholders |
| `src/domain/` | CFR-verified domain module — canonical warning, tolerances, label-requirements matrix (`README.md` inside explains the rules) |
| `src/extraction/` | `VisionProvider` interface + mock / OpenAI / Azure providers + reconciler |
| `src/compare/` | Deterministic comparators, the completeness check, and thresholds |
| `src/app/` | Verify-first UI (verdict-led) + `/api/verify` route + `/batch` |
| `eval/` | Evaluation harness + filename-keyed fixtures |
