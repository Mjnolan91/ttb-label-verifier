# TTB Label Verifier

[![CI](https://github.com/Mjnolan91/ttb-label-verifier/actions/workflows/ci.yml/badge.svg)](https://github.com/Mjnolan91/ttb-label-verifier/actions/workflows/ci.yml)

Upload a photo of an alcohol label. AI reads it into the full set of TTB-required fields, then
deterministic code checks the label against the application's claimed values and against TTB's
labeling rules, and returns an at-a-glance verdict: **Approve / Needs review / Reject**.

**Live demo:** https://ttb-label-verifier-matthew-nolan-s-projects.vercel.app — runs a real
vision model, so it can read any label photo.

![The verify screen: a real spirits label, front and back read together by the AI, checked field by field against the application, with an Approve verdict](docs/screenshot.png)

The approach, design decisions, and trade-offs are written up for reviewers in
[docs/TTB-Label-Verifier-Approach-and-Design.pdf](docs/TTB-Label-Verifier-Approach-and-Design.pdf)
(viewable on GitHub; same document as the
[.docx](docs/TTB-Label-Verifier-Approach-and-Design.docx)).

## What it does

- **Verifies a label against its application.** Brand name (fuzzy: case/punctuation noise passes,
  near-misses go to review), alcohol content (within the legal tolerance for the beverage class),
  and the government warning (verbatim against the statutory text, with caps/bold prefix checks)
  lead the screen; the other application fields (class/type, net contents, producer name and
  address, country of origin, and more) are compared whenever the application supplies them.
- **Kills manual data entry.** The AI reads front/back/neck photos together into the full TTB
  field set and pre-fills the application inputs as gray suggestions — Tab accepts one, a button
  accepts all. Every read exports as JSON or CSV.
- **Checks completeness per beverage type.** Each element TTB mandates for the class is flagged
  present / missing / malformed / unverifiable, so a label missing a required element can never
  be auto-approved.
- **Handles batch.** Drop a couple hundred images on [/batch](https://ttb-label-verifier-matthew-nolan-s-projects.vercel.app/batch):
  fronts and backs pair by filename, an optional CSV supplies claimed values, and results stream
  into a reviewable worklist with retries, in-place application editing, and CSV export. A header
  toggle switches between single and batch mode from anywhere.
- **Routes uncertainty to a human.** Low-confidence reads, near-misses, and unverifiable checks
  become "Needs review" — never a silent pass. CI fails if approve-precision drops below 0.98 on
  the labeled eval cases.

## Run it locally

Requires [Node.js](https://nodejs.org) 20.9 or newer.

```bash
git clone https://github.com/Mjnolan91/ttb-label-verifier.git
cd ttb-label-verifier
npm install
npm run dev        # → http://localhost:3000, zero API keys needed
```

Out of the box the app runs on an offline **mock** provider: it recognizes the bundled sample
labels (click **Load the sample label** on the verify screen) but cannot read arbitrary photos.
To read your own images, [enable a real vision provider](#enable-a-real-vision-provider) — the
live demo already runs one.

All checks run offline with no keys:

```bash
npm test           # 811 unit + integration + component tests (deterministic)
npm run eval       # accuracy over labeled fixtures; hard CI gate at 0.98 approve-precision
npm run typecheck  # strict TypeScript
npm run lint
npm run build      # production build (Next standalone)
```

## Try it in two minutes

1. Open the [live demo](https://ttb-label-verifier-matthew-nolan-s-projects.vercel.app) (or `npm run dev`).
2. Click **Load the sample label** ("No label handy?"): a real spirits label (Fireball Cinnamon
   Whisky, from the public TTB COLA registry) placed into the front and back slots with one click.
3. The AI reads the pair as one product and pre-fills "The application" inputs with gray
   suggestions; click **Accept all AI suggestions** (in real use the agent types what the COLA
   application claims).
4. The verdict appears once every field TTB requires for the beverage type is filled in.

| Sample | Defect | Expected verdict |
| --- | --- | --- |
| **Load the sample label** — the clean pair ([front](eval/fixtures/images/fireball-front.jpg) + [back](eval/fixtures/images/fireball-back.jpg)) | none | **Approve** |
| **Load the defective-warning version** — the same front + an [edited back](eval/fixtures/images/fireball-warning-not-bold-back.jpg) | warning prefix printed "Government Warning:" in title case, regular weight (an edited test image; the real label is compliant) | **Reject** — 27 CFR 16.22(a)(2) requires the all-caps bold prefix |

You never type the government warning: it is compared word for word against the statutory text
automatically. Typing a slightly different brand than the label prints shows the third verdict —
**Needs review** — which is what uncertainty gets instead of a guess.

## How it works

```
image(s) ──> VisionProvider(s) ──> reconciler ──> completeness check + comparators ──> verdict
             (probabilistic)       (vote/merge)    (pure, deterministic, tested)
```

- **AI extracts, code decides.** Vision models only transcribe the label into structured fields
  with per-field confidence. Every pass/review/fail decision is made by pure, unit-tested code —
  in a government context, "why was this rejected?" must be rules-based and reproducible.
- **Confidence is measured, not self-reported.** Each product is read several times in parallel
  (front + back ride one request as full-resolution parts) and a field's confidence is the
  agreement fraction across samples. Verdict-relevant fields that stay uncertain get bounded
  escalations — a strong-model re-read, a dedicated bold-prefix judge, a crop/derotate/upscale
  warning-focus pass — each able to clear a false alarm but never to silently flip a conflict to
  pass.
- **The rules live once, CFR-verified.** The statutory warning text, the per-class alcohol
  tolerance matrix, and the mandatory-elements matrix are hand-written in
  [`src/domain/`](src/domain/README.md) with inline citations, and never retuned to make a test
  pass.

## Project structure

```
src/
  domain/        CFR-verified rules: statutory warning text, tolerance matrix, label requirements
  extraction/    VisionProvider interface + 6 providers (mock default), self-consistency vote,
                 rescue / warning-judge / warning-focus escalations
  compare/       deterministic comparators, completeness check, thresholds, combined verdict
  batch/         filename pairing + CSV claimed-value matching
  pipeline.ts    end-to-end flow: read images → merge → readability gate → verdict
  app/           verify screen, /batch worklist, /api/verify routes
eval/            evaluation harness + labeled fixtures (the CI accuracy gate)
scripts/         live-latency measurement, sample-label builders, submission-doc generator
specs/           PROJECT_SPEC.md — requirements traced to the stakeholder interviews
docs/            reviewer-facing approach document (.pdf/.docx) + dated working artifacts
AGENTS.md        the architecture bible: the three checks, constraints, conventions
```

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript (strict) + Tailwind 4 + Vitest.
No database; the one runtime dependency beyond Next/React is
[sharp](https://sharp.pixelplumbing.com) (server-side crop/derotate/upscale for the
warning-focus pass). AI: OpenAI (hosted demo) or Google Gemini, and Azure OpenAI / Azure AI
Document Intelligence as the in-tenant production target — all behind one interface.

## Enable a real vision provider

Optional — the default `mock` needs nothing. Set `VISION_PROVIDER` plus its variables in
`.env.local` (full matrix with every knob documented in [`.env.example`](.env.example)):

```bash
# simplest: OpenAI directly, one key
VISION_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

Also supported: `gemini` (one key), `llm` (Azure OpenAI), `ocr` (Azure AI Document
Intelligence), and `ensemble` (both Azure providers in parallel, disagreements routed to
review). If a selected provider's variables are missing, the request fails loudly — it never
silently falls back to the mock. For real deployments the measured-recommended pairing is
`SELF_CONSISTENCY_SAMPLES=5` + `VISION_TIMEOUT_MS=8000`.

## Measured, not claimed

Performance and accuracy claims trace to dated measurements (the full story is in the
[approach document](docs/TTB-Label-Verifier-Approach-and-Design.pdf)):

- **Offline gate:** `npm run eval` scores 27 labeled cases (clean labels + deliberate defects) at
  100%, with the 0.98 approve-precision floor enforced in [CI](.github/workflows/ci.yml).
- **Live latency (deployed demo, 2026-06-10):** p50 3.1s / p95 5.2s over 15 sequential reads,
  15/15 verdicts correct, inside the brief's ~5s budget (single-image reads under the earlier
  7-sample/5s config; the front+back sample below pays the fuller multi-image path). The model
  split was chosen by A/B measurement: moving extraction to the strong model doubled the median
  for identical verdicts, so the fast model extracts and the strongest model is reserved for the
  narrow judgments.
- **Bundled sample (deployed demo, 2026-06-11):** the clean pair read 3/3 Approve at 6.6–8.7s;
  the defective-warning pair 3/3 Reject at 12.8–14.0s (the extra seconds are the warning-focus
  pass taking a zoomed look before committing to a hard fail).

## Deploying

**Vercel (the live demo).** Zero config: Vercel detects Next.js and auto-deploys from `main`.
Set `VISION_PROVIDER` + the provider key in Settings → Environment Variables; with none set it
serves mock mode.

**Azure** (the in-tenant production target — the extraction calls run inside the tenant, which
is what survives the outbound firewall described in the brief). Both paths work with zero keys
(mock mode) and pick up real extraction later via app settings; both assume the
[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and `az login`:

```bash
az group create --name ttb-label-verifier-rg --location eastus

# Path A: App Service
npm install && npm run build
az webapp up --name ttb-label-verifier --resource-group ttb-label-verifier-rg \
  --runtime "NODE:20-lts" --sku B1
# optional, to enable real extraction on the running app:
az webapp config appsettings set \
  --name ttb-label-verifier --resource-group ttb-label-verifier-rg \
  --settings VISION_PROVIDER=llm \
             AZURE_OPENAI_ENDPOINT="https://<res>.openai.azure.com" \
             AZURE_OPENAI_API_KEY="<key>" \
             AZURE_OPENAI_DEPLOYMENT="<deployment>"

# Path B: Container Apps (uses the repo's multi-stage Dockerfile)
az acr create --resource-group ttb-label-verifier-rg --name ttblabelverifieracr --sku Basic
az acr build --registry ttblabelverifieracr --image ttb-label-verifier:latest .
az containerapp up --name ttb-label-verifier --resource-group ttb-label-verifier-rg \
  --image ttblabelverifieracr.azurecr.io/ttb-label-verifier:latest \
  --target-port 3000 --ingress external
```

## Documentation

- [docs/TTB-Label-Verifier-Approach-and-Design.pdf](docs/TTB-Label-Verifier-Approach-and-Design.pdf) — the reviewer-facing approach document: summary, what the stakeholders asked for, how it was implemented, and why this architecture.
- [`AGENTS.md`](AGENTS.md) — the architecture bible: the three checks, the latency budget, the thresholds philosophy, conventions.
- [`specs/PROJECT_SPEC.md`](specs/PROJECT_SPEC.md) — requirements traced to the stakeholder interviews.
- [`src/domain/README.md`](src/domain/README.md) — the CFR-verified domain module and its citations.
- [`.env.example`](.env.example) — every provider and tuning knob, documented.
