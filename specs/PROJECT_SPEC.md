# Project Spec — AI-Powered Alcohol Label Verification (Prototype)

## Context
TTB compliance agents review label applications by eye: does the brand name, alcohol
content, and government warning on the label match what the application claims? A large
share of that work is rote matching. This prototype automates the routine matching and
flags the rest for a human — it does not try to replace human judgment.

## Requirements distilled from the discovery interviews
Each requirement below traces to a stakeholder, so the "why" stays visible:

- **~5-second result ceiling (hard).** A prior scanning vendor took 30–40s per label and
  was abandoned. Speed is the #1 adoption gate. → parallel extraction with per-call timeouts.
- **Usable by a 73-year-old; half the team is 50+.** One clean screen, large targets, no
  hunting for buttons. → accessibility-first single-page UI.
- **Tolerant brand matching.** "STONE'S THROW" vs "Stone's Throw" is obviously the same
  thing (Dave, 28-yr agent). → normalized + fuzzy brand comparison with a `review` state.
- **Strict warning matching.** Word-for-word; "GOVERNMENT WARNING:" must be caps and bold;
  title-case gets rejected (Jenny, junior agent). → exact comparison against the canonical
  statutory text + prefix format checks.
- **Network blocks many outbound domains; firewall killed the last vendor's ML endpoints**
  (Marcus, IT). For this deployed prototype the agent's browser only uploads to our server,
  so it is not blocked — but the extraction layer is built behind a swappable interface, and
  one provider option (OCR) can run on-prem, so a future internal deployment survives the
  firewall. → `VisionProvider` interface + a locally runnable second extractor.
- **Batch (200–300 labels at peak).** Importers dump large batches; today they are processed
  one at a time. → batch upload + results table + CSV export (stretch).
- **Standalone, no PII, no COLA.** Explicitly out of scope for the prototype (Marcus). →
  no auth, nothing sensitive stored, no COLA integration.
- **Bad photos are out of scope** but should fail gracefully (Jenny). → unreadable image
  prompts a re-upload instead of asserting a verdict.

## Architecture
"AI extracts, code compares." A multimodal model (and optionally a second OCR/model)
extract structured fields from the image behind the `VisionProvider` interface. A reconciler
marks fields where the extractors agree as high-confidence and routes disagreements to
review. A deterministic, unit-tested comparator produces the pass/review/fail verdict for
each field. Keeping the verdict in deterministic code (not the model) is what makes the
result auditable — essential in a government compliance setting.

## The "better than humans" framing
The system beats humans on **consistency** (identical input -> identical verdict, every
time), **throughput** (batch, tireless), and **recall of routine checks** (catches every
title-case warning a tired human skims past). It does NOT claim to out-read a person on a
glare-y photo, and it keeps the human as the final judge. Confidence thresholds are
**asymmetric**: it almost never auto-approves a bad label, preferring to route uncertainty
to review. We prove all of this with an evaluation harness, not assertions.

## Scope tiers (map to prd.json priorities)
- **MVP (US-001..US-008):** scaffold, domain + canonical warning, provider interface + mock,
  deterministic comparator, verify API, upload UI, result UI, graceful errors.
- **Differentiators (US-009..US-012):** real LLM provider, second extractor + parallel
  reconciler, asymmetric thresholds, evaluation harness.
- **Stretch (US-013..US-014):** batch + CSV export, deploy config + public URL.

## Test labels
Generate test labels with an AI image tool (per the brief), and deliberately include broken
ones — a title-case warning, an ABV off by a point, a brand typo, a missing warning — so the
checks are shown catching failures, not just passing clean inputs.

## Deliverables
Source repo + README (approach, tools, assumptions, trade-offs, and a short mapping of build
decisions back to the stakeholder needs above), and a deployed URL reviewers can test.
