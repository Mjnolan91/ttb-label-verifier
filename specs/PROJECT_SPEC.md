# Project Spec — AI-Powered Alcohol Label Verification (Prototype)

## Context
TTB compliance agents review label applications by eye: does the brand name, alcohol
content, and government warning on the label match what the application claims? A large
share of that work is rote matching. This prototype automates the routine matching and
flags the rest for a human — it does not try to replace human judgment.

The product is **verify-first**. The **primary** path is the claimed-vs-application comparison: a
pure comparator matches the label field-by-field against the application (brand, class/type,
alcohol content, net contents, producer name, producer address, country of origin, plus the
automatic statutory government warning) and returns an Approve / Needs review / Reject verdict; on
the single screen the application's TTB-required fields for the beverage type are required before a
verdict. Underneath, the AI always reads the label image(s) into the full TTB field set, a
deterministic **completeness** check runs against the mandatory-information requirements for the
detected beverage type (each element flagged present / missing / malformed / unverifiable), and the
result exports as JSON or CSV — no manual data entry.

## Requirements distilled from the discovery interviews
Each requirement below traces to a stakeholder, so the "why" stays visible:

- **~5-second result ceiling (hard).** A prior scanning vendor took 30–40s per label and
  was abandoned; speed is the #1 adoption gate (Sarah, supervising agent). → parallel
  extraction with per-call timeouts.
- **Usable by a 73-year-old; half the team is 50+.** One clean screen, large targets, no
  hunting for buttons (Sarah). → accessibility-first single-page UI.
- **Tolerant brand matching.** "STONE'S THROW" vs "Stone's Throw" is obviously the same
  thing (Dave, 28-yr agent). → normalized + fuzzy brand comparison with a `review` state.
- **Strict warning matching.** Word-for-word; "GOVERNMENT WARNING:" must be caps and bold;
  title-case gets rejected (Jenny, junior agent). → exact comparison against the canonical
  statutory text + prefix format checks.
- **Network blocks many outbound domains; firewall killed the last vendor's ML endpoints**
  (Marcus, IT). For this deployed prototype the agent's browser only uploads to our server,
  so it is not blocked. The firewall-survival story is that the extraction layer is
  **Azure-native and runs in-tenant**: it sits behind a swappable `VisionProvider` interface,
  and the real providers — `llm` → **Azure OpenAI** (multimodal), `ocr` → **Azure AI Document
  Intelligence** (OCR) — execute *inside the Azure tenant* rather than calling an external ML
  endpoint the outbound firewall would block. → generic `VisionProvider` interface + Azure-native
  reference providers; mock stays the default so nothing requires those endpoints to be reachable.
- **Batch (200–300 labels at peak).** Importers dump large batches; today they are processed
  one at a time (Sarah). → batch upload + results table + CSV export (stretch).
- **Standalone, no PII, no COLA.** Explicitly out of scope for the prototype (Marcus). →
  no auth, nothing sensitive stored, no COLA integration.
- **Bad photos are out of scope** but should fail gracefully (Jenny). → unreadable image
  prompts a re-upload instead of asserting a verdict.

## Architecture
"AI extracts, code compares," and the flow is **extraction-always, verify-first in the UI**. A
multimodal model (and optionally a second OCR/model) extract structured fields from the image behind
the `VisionProvider` interface. A reconciler marks fields where the extractors agree as
high-confidence and routes disagreements to review. The **always-on** deterministic step is the TTB
**completeness** check: each mandatory element for the detected beverage class is flagged present /
missing / malformed / unverifiable, with no application required. The comparator produces the
pass/review/fail verdict field by field across the full application (the three CFR-core checks plus
class/type, net contents, producer name/address, country of origin); on the single screen the
application is required for a verdict, and the headline takes the worse of the comparison and the
completeness check. Keeping every verdict in deterministic code (not the model) is what makes the
result auditable — essential in a government compliance setting.

**Extraction is Azure-native (in-tenant), mock by default.** The interface is generic, but
the two reference providers are Azure so they survive Marcus's outbound firewall by running
inside the tenant: `llm` → Azure OpenAI (multimodal), `ocr` → Azure AI Document Intelligence
(OCR). The default `mock` provider keys off the fixture **filename** (not image bytes), so the
app and the entire test suite run offline with no keys; real providers are opt-in via
`VISION_PROVIDER` + the matching provider env vars only (an OpenAI/Gemini key, or the Azure
endpoint + key). When both Azure providers run, they are reconciled in **parallel** with a
per-call timeout (~3s mock / ~8s real, `VISION_TIMEOUT_MS`) to stay inside the 5s budget.

**The alcohol check is driven by a full CFR-verified beverage-tolerance matrix**, not a single
constant: the beverage `classType` is an **input** that *selects* the tolerance rule — distilled
spirits ±0.3pp (27 CFR 5.65(c)); wine ≤14% ±1.5pp and wine >14% ±1.0pp (27 CFR 4.36(b)(1),
with the 4.36(c) 14% tax-class boundary applied as a clamp); malt beverages/beer ±0.3pp
(27 CFR 7.65(c), with the 0.5% floor at 7.65(c) and the 2.5% low/reduced cap at 7.65(d)); and
cider resolving to the wine or malt rule by production method (defaulting to wine ≤14%). The
alcohol-content *requirement* is itself per class: mandatory for spirits and wine >14%, but
**optional by default for malt beverages** (27 CFR 7.63(a)(3)) and satisfiable on wine ≤14% by a
"table wine" / "light wine" designation (27 CFR 4.36(a)). The renumbered Part 5 / Part 7 citations
reflect TTB's 2022 modernization (T.D. TTB-176, eff. Mar 11, 2022); Part 4 (wine) was not
renumbered. The government warning is required at ≥0.5% ABV (27 CFR 16.10); products under 0.5%
are exempt — a handled edge case, not a violation. These values live once in `src/domain/` with inline CFR citations and are treated
as read-only statutory ground truth; a few low-confidence resolutions (cider classification,
the `unknown`-class default band) are flagged "VERIFY before production" rather than asserted.

## The "better than humans" framing
The system beats humans on **consistency** (identical input -> identical verdict, every
time), **throughput** (batch, tireless), and **recall of routine checks** (catches every
title-case warning a tired human skims past). It does NOT claim to out-read a person on a
glare-y photo, and it keeps the human as the final judge. Confidence thresholds are
**asymmetric**: it almost never auto-approves a bad label, preferring to route uncertainty
to review. We prove all of this with an evaluation harness, not assertions.

## Scope
- **MVP:** AI extraction of the full TTB field set, the TTB completeness check per beverage type,
  the deterministic claimed comparison over a required application (full field-by-field: the three
  CFR-core checks — brand fuzzy / ABV tolerance / strict government warning — plus class/type, net
  contents, producer name/address, country of origin), an accessibility-first single-screen UI, and
  graceful handling of unreadable images (re-upload prompt, never a fabricated verdict).
- **Differentiators:** real Azure-native providers (Azure OpenAI for `llm`, Azure AI Document
  Intelligence for `ocr`, plus OpenAI- and Gemini-direct paths for the hosted demo) behind the generic
  `VisionProvider` interface, a parallel reconciler that routes disagreements to review, asymmetric
  compliance-aware thresholds (minimize false approvals), and an evaluation harness that turns
  "better than human" into measured precision/recall + latency.
- **Stretch:** batch upload (200–300 labels) with a results table and CSV export, plus Azure deploy
  config (App Service or Container Apps) behind a public URL.

## Test labels
Generate test labels with an AI image tool (per the brief), and deliberately include broken
ones — a title-case warning, an ABV off by a point, a brand typo, a missing warning — so the
checks are shown catching failures, not just passing clean inputs. The offline suite is
**hermetic**: the mock provider keys off the fixture **filename** (not pixels), so unit tests,
the `/api/verify` integration test, and `npm run eval` all run with no real images and no
network. Real label images are **user-supplied later** at the exact paths in
`eval/fixtures/images/MANIFEST.md`, needed only when a real Azure provider or a live demo runs.

## Deliverables
Source repo + README (approach, tools, assumptions, trade-offs, and a mapping of build
decisions back to the stakeholder needs above), and a deployed URL reviewers can test (the public
demo is hosted on Vercel; Azure App Service / Container Apps is the in-tenant production target; the
app also runs end-to-end in mock mode with zero keys).
