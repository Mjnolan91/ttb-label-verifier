# TTB Label Verifier

Upload a photo of an alcohol label. AI reads it into the full set of TTB-required fields, then
deterministic code checks the label against the application's claimed values and against TTB's
labeling rules, and returns an at-a-glance verdict: **Approve / Needs review / Reject**.

**Live demo:** https://ttb-label-verifier-matthew-nolan-s-projects.vercel.app
(runs a real vision model, OpenAI gpt-4.1, so it can read any label photo)

![The verify screen: a bourbon label read by the AI, checked field by field against the application, with an Approve verdict](docs/screenshot.png)

Built for the take-home brief: the three core checks (brand name, alcohol content, government
health warning) lead the screen. The same engine also extracts the full TTB field set (killing the
manual data entry the agents complained about), runs a per-beverage-type completeness check, exports
JSON/CSV, and handles batch uploads.

## Try it in two minutes

1. Open the [live demo](https://ttb-label-verifier-matthew-nolan-s-projects.vercel.app).
2. Grab a sample label: the demo's upload screen offers all three as one-click downloads ("No
   label handy?"), or use the links in the table below (on GitHub, open the link and use the
   "Download raw file" button). Any bottle photo of your own works too.
3. Upload it as the front label. The AI reads it and pre-fills "The application" inputs with grey
   suggestions; press Tab to accept one, or click **Accept all AI suggestions**. (In real use the
   agent would type what the COLA (Certificate of Label Approval) application claims. Accepting
   the suggestions simulates an application that matches the label.)
4. The verdict appears as soon as every field TTB requires for the beverage type is filled in.

| Sample label | The defect on the label | What to enter | Expected verdict |
| --- | --- | --- | --- |
| [Clean bourbon](eval/fixtures/images/demo-old-tom-clean.png) | none | accept all suggestions | **Approve** |
| [Title-case warning](eval/fixtures/images/demo-warning-title-case.png) | warning prefix printed "Government Warning:" instead of all-caps bold "GOVERNMENT WARNING:" | accept all suggestions | **Reject**. 27 CFR 16.22(a)(2) requires the all-caps bold prefix |
| [Brand typo](eval/fixtures/images/demo-brand-typo.png) | label prints "Old Tomm Distillery" (extra "m") | type **Old Tom Distillery** as the brand, accept the rest | **Needs review**. A near-miss is routed to a human, not auto-decided |

You never type the government warning: the tool compares the label's warning text word for word
against the statutory text automatically. (Live model reads can occasionally vary; locally, the
offline mock reproduces these verdicts deterministically.)

For the batch workflow (the brief's importers dumping 200 to 300 applications at once), open
[/batch](https://ttb-label-verifier-matthew-nolan-s-projects.vercel.app/batch): drop many images,
fronts and backs pair by filename, optionally attach a CSV of claimed values (the downloadable
template ships ready-made rows for the three sample labels), and results stream into a reviewable
worklist with CSV export. Each row leads with a clickable thumbnail; two rows that read the same
brand (camera filenames defeat pairing) offer a one-click, human-confirmed combine that re-reads
them as one product. Transient service failures auto-retry with jittered backoff and adaptive
pacing, narrating each attempt on the row and ending in an honest error plus a Retry (and a
"Retry all failed" sweep) rather than a dead end. The review drawer lets you supply or correct
application values in place, so a batch without a CSV is still fully workable, and rows settle one
by one, so a 300-label dump is triaged continuously rather than waited on. On the single verify
screen, a multi-photo selection places itself: filename tokens (name-front, name-back, name-neck)
claim their slots and the rest fill the open slots in order.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000, zero API keys needed
```

Requires Node 20.9+. With no keys the app runs on an offline **mock** provider: it recognizes the
bundled sample labels by filename (including the three above, which yield the same verdicts
locally) but cannot read arbitrary photos. To read your own images locally,
[enable a real vision provider](#enable-a-real-vision-provider); the live demo already runs one.

```bash
npm test           # unit + integration + component tests (offline, no keys, deterministic)
npm run eval       # accuracy + latency over labeled fixtures; gates CI (see below)
npm run typecheck  # strict TypeScript
npm run lint
npm run build      # production build (Next standalone)
```

## How it works: AI extracts, code decides

```
image(s) ──> VisionProvider(s) ──> reconciler ──> completeness check + comparator ──> verdict
             (probabilistic)       (agree/disagree)  (pure, deterministic, tested)
```

- **Extraction is probabilistic, so it never gets the final word.** Vision models read the
  front/back/neck images together into one structured record with per-field confidence. Every
  pass/review/fail decision is made afterwards by pure, unit-tested code. In a government context,
  the answer to "why was this rejected?" must be rules-based and reproducible, so a model never
  makes the compliance verdict.
- **Providers are swappable behind one interface.** `mock` (default, offline), `openai`,
  `gemini`, `llm` (Azure OpenAI), `ocr` (Azure AI Document Intelligence), and `ensemble`
  (both Azure providers in parallel, disagreements routed to review). Adding Gemini was a ~300-line
  drop-in behind the [`VisionProvider`](src/extraction/VisionProvider.ts) interface.
- **The real providers use current best practice.** Strict structured outputs
  (`response_format: json_schema` on the OpenAI-dialect providers, Gemini's `responseSchema`
  equivalent) so the model is constrained to the exact field shape; bounded retry on 429/5xx and a
  self-limiting per-call timeout on every real provider. A multi-image product (front + back) is
  read JOINTLY by default: every image rides ONE request as separate full-resolution, position-
  labeled parts, so the model allocates fields with cross-panel context and a two-image product
  costs half the requests (never a stitched composite — vision APIs cap total per-image resolution,
  so splicing halves each label's pixels and degrades the fine print exactly where the government
  warning lives; a model-reported front-vs-back CONFLICT on a field is capped to review, never
  silently resolved). Each read is sampled N times in parallel
  (self-consistency, default 3) and per-field confidence is the agreement fraction across reads,
  which is better calibrated than a model's self-reported confidence. The vote is CLUSTERED, not
  literal: reads that differ only cosmetically (a dropped cedilla or comma, a less complete variant
  of the same value) count as one reading, while a numeric difference never clusters — so noise
  doesn't dilute confidence but a real conflict still does. An ADAPTIVE second batch is available
  as an opt-in (`SELF_CONSISTENCY_ESCALATION`): when a verdict-relevant field lands just below the
  review gate, extra reads are drawn once (the knob's value, capped at 3) and the vote re-runs — at
  the recommended 2, a single noisy sample out
  of three recovers to 4/5 agreement instead of sending a correct field to review, while genuine
  splits stay flagged. (Off by default on the demo, by measurement: contested reads pay one extra
  parallel batch, which measurably pushed the live median toward the ~5s ceiling.) When a
  verdict-relevant field still lands below the review gate, a LOW-CONFIDENCE RESCUE re-reads
  exactly those fields on the strongest model in one bounded call across all the product's images:
  if the smarter read agrees with the fast majority, two independent models agreeing clears the
  field for verdict; if it disagrees, the smarter read becomes the suggestion but the field still
  goes to a human. A rescue can clear a false alarm; it can never silently flip a conflict to
  pass. A
  dedicated second pass
  judges whether the "GOVERNMENT WARNING:" prefix is printed in bold; because the warning is the
  one check that can hard-fail a label, that judge can run on a stronger model than the bulk reads
  (`WARNING_JUDGE_MODEL`), and "verified" means verified: when neither the extraction nor the judge
  can confirm the prefix format, the verdict says so and routes to review instead of silently
  passing.
- **The rules live once, in a CFR-verified module.** The canonical warning text, the per-class
  alcohol tolerance matrix, and the mandatory-elements matrix are hand-written in
  [`src/domain/`](src/domain/README.md) with inline CFR citations, and treated as statutory:
  never reworded or retuned to make a test pass.
- **Uncertainty routes to a human.** Low-confidence fields downgrade to review; an unreadable
  photo gets a "please re-upload" prompt instead of a guessed verdict; the verdict takes the worse
  of the application comparison and the completeness check, so a label missing a TTB-mandatory
  element can never be auto-approved.

## Design decisions, traced to the brief

Every major choice maps to a person from the discovery interviews. (Full requirement trace in
[`specs/PROJECT_SPEC.md`](specs/PROJECT_SPEC.md).)

| Who | Their need | What was built |
| --- | --- | --- |
| **Sarah**, Deputy Director | A prior scanner took 30-40s per label and was abandoned: results must come back in about 5 seconds.<br>Agents range from fresh graduates to a 73-year-old benchmark user.<br>Importers dump 200-300 applications at once | A hard latency budget: providers run in parallel with a per-call timeout (~3s mock / ~8s real), reconciling whatever returned instead of blocking on a straggler.<br>One accessibility-first screen (WCAG 2.1 AA targets: 4.5:1 contrast, 44px targets, full keyboard order, visible focus).<br>Batch upload with streaming results and CSV export |
| **Marcus**, IT | The outbound firewall blocked the last vendor's ML endpoints. Azure shop. Standalone prototype, no PII | Extraction sits behind a swappable `VisionProvider` interface and the production providers are Azure-native, so the model calls run inside the tenant the firewall trusts. No auth, no PII stored, no COLA integration. Mock mode means the app and full test suite run with zero keys |
| **Dave**, 28-year agent | "STONE'S THROW" vs "Stone's Throw" is obviously the same product; pure pattern matching creates false rejections | Fuzzy brand comparison: normalize case, whitespace, punctuation, and smart quotes, then compare. Exact after normalization passes; a near-miss goes to review with the discrepancy shown; only a clear mismatch fails |
| **Jenny**, junior agent | The warning must match word for word, and "GOVERNMENT WARNING:" must be all-caps and bold. Title case gets rejected. Bad photos shouldn't crash the flow | Strict verbatim comparison against the statutory text, plus explicit all-caps and bold checks on the prefix (bold is tri-state: "undetectable" is routed to review, not called a violation). Unreadable images fail gracefully to a re-upload prompt |

The unifying thesis (expanded in [`AGENTS.md`](AGENTS.md)): be superhuman on the axes where
machines win (consistency, throughput, tireless recall of routine checks) while routing ambiguity
to a human. Thresholds are deliberately asymmetric: an unnecessary review is cheap, a false
approval is not.

## Measured, not claimed

`npm run eval` runs the full pipeline offline over labeled fixtures
([`eval/fixtures/cases.json`](eval/fixtures/cases.json)): clean labels plus deliberately broken
ones (title-case warning, out-of-tolerance ABV, brand typo, missing warning, an unreadable photo
that must never auto-approve). It prints per-field precision/recall and latency p50/p95, and it is
a hard gate: if precision on "approve" drops below **0.98**, the run exits non-zero and
[CI fails](.github/workflows/ci.yml). A false approval is the one error class this tool refuses to
ship.

The offline latency it prints is sub-millisecond because the mock skips the model call; it measures
the pipeline, not a vision model. Real-deployment latency is measured too:
[`scripts/measure-live-latency.ts`](scripts/measure-live-latency.ts) posts the three sample labels
to a deployed `/api/verify` end to end and checks each verdict. Against the live demo (OpenAI on
Vercel, gpt-4.1 extraction + a gpt-5.5 warning judge, a 7-wide self-consistency vote under a 5s
straggler cap, 15 sequential reads, 2026-06-10): **p50 3.1s, p95 5.2s, 15/15 verdicts correct, no
timeouts**. The median sits comfortably inside the ~5s budget; the single 5.2s read was the first
request, which pays the serverless cold start.

That 7-wide/5s pairing was later SUPERSEDED by its own measurement gap: the 15 reads were
single-image demo labels, and on a real front+back product the dense back label (the statutory
warning paragraph dominates generation time) reads in ~5s+, so the 5s cap could kill every sample
of the back image. The pipeline now reports a dropped image instead of silently proceeding (the
response carries `imageFailures`, both screens warn and offer a retry, and a partial read can never
headline Approve), and the recommended pairing is **`SELF_CONSISTENCY_SAMPLES=5` +
`VISION_TIMEOUT_MS=8000`** (measured: the same dense pair reads fully in ~4.9s). The levers are
documented in [`.env.example`](.env.example), including `SELF_CONSISTENCY_ESCALATION` (opt-in extra
reads on a contested verdict-relevant field; accuracy over tail latency) and the model choice.
Uploads are downscaled in the browser to keep request sizes inside the budget.

The deployed config was chosen by A/B measurement, not preference: on OpenAI (local dev server,
real API, 2026-06-10), gpt-4.1 extraction with a gpt-5.5 warning judge measured **6/6 verdicts at
p50 2.8s, p95 3.0s**, while moving extraction itself to gpt-5.5 doubled the median (p50 6.5s) for
identical verdicts —
so on either vendor, the fast model transcribes and the strongest model judges the one check that
can hard-fail a label. (The gpt-5/o-series' chat params differ from the gpt-4 line; the provider
adapts automatically — see `src/extraction/openaiTuning.ts`.)

The same split holds on Gemini, measured the same way (local dev server, real Gemini API, 9
sequential reads per config, 2026-06-10); an earlier Gemini deployment of this demo measured
p50 4.1s, p95 7.7s, 15/15 verdicts correct on the same script. Flash extraction with the Pro warning judge: **9/9 verdicts correct, p50
3.3s, p95 4.5s** — inside the budget, because the judge runs concurrently with extraction and its
~2s hides behind the extraction wall-clock. Running extraction itself on the Pro model: p50 6.0s,
p95 8.1s, and 4 of 9 requests failed outright on the preview model's 25-requests/minute quota
(extraction needs ~4 Pro calls per verify; the judge needs at most 3 and degrades gracefully to
Flash on a 429). That is why extraction stays on Flash and the strongest model is spent only on
the one judgment that can hard-fail a label.

## Assumptions and trade-offs

- **Mock provider by default, real extraction opt-in.** Everything runs hermetically with no
  network and no keys, which keeps tests and CI deterministic. The cost: out of the box you
  exercise the pipeline and verdict logic, not a real model's reading accuracy. The live demo runs
  a real provider so reviewers get both.
- **Test fixtures key off the image filename, not pixels.** That is what makes the offline suite
  possible. The defect fixtures are lightweight SVG placeholders; the three demo labels are real
  rasters so a live provider extracts genuine pixels from them.
- **The application is required for a verdict.** The brief's core task is "does the label match
  the application", so the screen leads with that comparison and blocks the verdict until the
  TTB-required fields for the beverage type are supplied. The label read and completeness check
  still render without one.
- **Azure is the chosen cloud, not a multi-cloud abstraction.** The in-tenant Azure providers are
  the answer to Marcus's firewall constraint. The interface stays generic; OpenAI and Gemini
  providers exist for keyless-Azure demo situations, and the public demo uses one.
- **The alcohol tolerance is selected by beverage class, from the CFR.** Spirits ±0.3pp, wine
  ±1.5pp/±1.0pp around the 14% tax-class boundary, malt ±0.3pp with the 0.5% floor, each with its
  carve-outs (alcohol content is even optional on malt labels by default). The full matrix, the
  citations, and the two judgment calls flagged "VERIFY before production" live in
  [`src/domain/`](src/domain/README.md).
- **The government warning text is statutory and verbatim** (27 CFR 16.21, re-verified unchanged
  as of 2026-06). It lives once in [`src/domain/warning.ts`](src/domain/warning.ts), guarded by a
  byte-for-byte unit test. The 2025 Surgeon General cancer advisory is a proposal, not law; if
  Congress amends the text, the fix is editing that one constant.
- **Deliberate scope cuts.** No COLA integration, no auth, no PII storage, no image
  deskewing/glare correction (bad photos get a re-upload prompt, per the brief's guidance), and no
  physical type-size checks (millimeter minimums can't be measured from extracted text). The same
  boundary covers the TTB checklists' placement rules (same field of vision, "separate and apart",
  no intervening text): extraction merges a label's text and discards layout. Rules that need TTB's
  records rather than the label itself (formula approvals, permit and brewer's-notice matching,
  multi-plant coding systems) are also out: the tool sees only the image and the application values.
- **No rate limiting on the demo endpoint.** `/api/verify` is unauthenticated and, with a real
  provider configured, fans out to multiple model calls per request, so a hammering client could
  exhaust the demo key's quota. Uploads are size- and type-capped, but per-client throttling is
  left to the platform or an API gateway in a real deployment; documented here rather than
  hand-rolling middleware into a prototype.
- **One build-time network fetch.** `next/font/google` downloads the Inter font during
  `npm run build` only. Dev, tests, and the running app are fully offline; a strictly air-gapped
  build would swap in `next/font/local`.

## Enable a real vision provider

Optional: the default `mock` needs nothing. Set `VISION_PROVIDER` plus the matching variables
(all documented in [`.env.example`](.env.example)) in `.env.local`:

```bash
# Option A: OpenAI directly (simplest, one key)
VISION_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Option B: Google Gemini directly (one key, from aistudio.google.com/apikey)
VISION_PROVIDER=gemini
GEMINI_API_KEY=...

# Option C: Azure OpenAI (the in-tenant production target)
VISION_PROVIDER=llm
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=<your-vision-capable-deployment>

# Option D: Azure AI Document Intelligence (dedicated OCR)
VISION_PROVIDER=ocr
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://<your-resource>.cognitiveservices.azure.com
AZURE_DOCUMENT_INTELLIGENCE_KEY=<key>

# Option E: ensemble, both Azure providers in parallel with disagreement -> review (needs both sets)
VISION_PROVIDER=ensemble
```

If a selected provider's variables are missing, the request fails loudly with an actionable error.
It never silently falls back to the mock and pretends to read the image.

Two optional knobs tune accuracy against cost: `SELF_CONSISTENCY_SAMPLES` (how many times each
image is read; agreement becomes the confidence) and `WARNING_JUDGE_MODEL` (which model runs the
dedicated government-warning format judge). On the Gemini provider the judge already **defaults to
the strongest available model** (`gemini-3.1-pro-preview`) and automatically falls back to the
extraction model if that call fails (a rotated preview id or its 25-requests/minute quota must
degrade to the Flash judgment, never to no judgment); set `WARNING_JUDGE_MODEL` to pin something
else. The OpenAI provider mirrors that: the judge **defaults to `gpt-5.5`** (the measured split
above) and falls back to `OPENAI_MODEL` if the call fails; set `WARNING_JUDGE_MODEL` to pin
something else. On Azure the judge defaults to the extraction deployment and the variable
upgrades it.

## Internationalization (a design note, deliberately not shipped)

The UI is English-only on purpose, but the i18n boundary was thought through, because in this
domain it is unusual: the content that matters most is **regulatory English** and must stay that
way. The statutory government warning (27 CFR 16.21) is verbatim English by law and is never
translated; extracted label values are whatever the label prints; the field-level audit reasons
cite CFR sections; and the CSV export schema is a stable interface. What a Spanish-speaking
reviewer would actually need translated is the UI chrome: headings, buttons, step labels, verdict
names, and helper copy.

The design that fits this codebase, if shipped: a typed dictionary module (`en`/`es` objects behind
one `Dict` type, so a missing key is a compile error), a React context with an `EN/ES` toggle next
to the theme toggle, English as the default so all existing tests and the eval pass unchanged, and
the regulatory-English boundary documented at the dictionary so the statutory warning, CFR-cited
audit prose, and CSV schema are excluded by construction. No locale routing: a reviewer tool wants
a per-person preference, not per-URL content. It is cut from this submission because a
half-translated compliance screen (Spanish chrome around English statutory text) reads worse than a
clean English one; the boundary decision is the part worth showing.

## Deploying

**Vercel (the live demo).** Zero config: Vercel detects Next.js and auto-deploys from `main`. Set
`VISION_PROVIDER` and the provider key in Settings -> Environment Variables so the hosted app reads
real uploads; with none set it serves mock mode.

**Azure (the in-tenant production target).** The real extractors run inside the Azure tenant,
which is what survives the outbound firewall that killed the previous vendor. Either path works
with zero keys (mock mode) and picks up real extraction later via app settings. Both assume the
[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and `az login`.

```bash
az group create --name ttb-label-verifier-rg --location eastus

# Path A: App Service (simplest)
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

## Project layout

| Path | Purpose |
| --- | --- |
| [`src/domain/`](src/domain/README.md) | CFR-verified rules: canonical warning, tolerance matrix, mandatory-elements matrix |
| [`src/extraction/`](src/extraction) | `VisionProvider` interface, the six providers, reconciler, self-consistency |
| [`src/compare/`](src/compare) | Deterministic comparators, completeness check, thresholds, combined verdict |
| [`src/pipeline.ts`](src/pipeline.ts) | The end-to-end flow: read images, merge, gate on readability, verdict |
| [`src/app/`](src/app) | The verify screen, `/api/verify` route, `/batch` worklist |
| [`eval/`](eval) | Evaluation harness + labeled fixtures (the CI accuracy gate) |
| [`AGENTS.md`](AGENTS.md) | The project bible: architecture, the three checks, conventions |
| [`specs/PROJECT_SPEC.md`](specs/PROJECT_SPEC.md) | Requirements traced to the stakeholder interviews |

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript (strict) + Tailwind 4 + Vitest. No
database, no other runtime dependencies. AI: OpenAI (hosted demo) / Google Gemini, and Azure OpenAI
/ Azure AI Document Intelligence (in-tenant target), all behind one interface.
