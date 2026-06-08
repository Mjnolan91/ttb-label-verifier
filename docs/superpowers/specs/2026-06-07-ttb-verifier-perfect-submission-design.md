# Design Spec — TTB Label Verifier "Perfect Submission" Pass

- **Date:** 2026-06-07
- **Status:** Approved (design); pending spec review → implementation plan
- **Author:** Claude (brainstorming session with Matt)
- **Scope:** Full implementation across seven workstreams (A–G)

---

## 1. Context & goal

This is an evaluated take-home: an "AI-Powered Alcohol Label Verification App" for the
TTB Compliance Division. The brief frames the agent's core job as **verification** —
"checks that what's on the label matches what's in the application. Brand name matches?
ABV is correct? Government warning is there?" — under hard constraints: **~5 s latency**,
**usable by a 73-year-old** (one clean screen, no hunting), **offline-by-default** (firewall
blocks third-party AI endpoints; in-tenant Azure is the survival story), **no PII**, and a
**batch path** for 200–300 labels at peak.

The current codebase pivoted to **extraction-first with verification optional**. That keeps a
real strength (it kills the data-entry drudgery stakeholders complained about) but buries the
brief's literal core. This pass repositions verification to first-class **while keeping
extraction**, fixes a brand/producer-name extraction defect, aligns the field set to current
27 CFR law, adds an accessible click-to-zoom image view, removes dead files, and refactors the
field set to a single source of truth so the codebase reads as Fortune-50 quality.

### North star
One accessible screen that verifies a label against an application
(**brand / ABV / government warning → Approve / Needs review / Reject**) front-and-center, with
full extraction + a per-beverage-type completeness check as the supporting layer. Law-accurate,
clean, fast, and obvious.

### Approved decisions (from brainstorming)
1. **Positioning:** Verify front-and-center **+** keep extraction.
2. **Scope:** Full implementation (plan → build, keeping `typecheck → lint → test → eval` green).
3. **Legal:** Enforce only in-force law; fix the sulfite over-strictness; **add a small,
   non-blocking UI "forward-looking" note** for 2025 proposals.
4. **Samples:** **Delete `public/samples/`** (dead code). Consequence: the honest demo path is
   the deployed URL on a real provider (or local with a key); mock-mode messaging must say so.

---

## 2. Discovery findings (evidence base)

Verified by a 7-agent sweep (5 codebase + 2 CFR-law, every citation checked against live
eCFR/GPO/Federal Register). Key findings, with anchors:

### Codebase
- **Field set duplicated in ~7 places** with no single source of truth: `RawExtractedFields`
  (`src/extraction/extractedShape.ts:18`), `mapRawExtracted` (`extractedShape.ts:44`),
  `reconcile.ts` `VALUE_FIELDS`/`CONF_KEY` (`src/extraction/reconcile.ts:83`,`:103`),
  `completeness.fieldFor` (`src/compare/completeness.ts:40`), `ExtractedFieldsView` rows
  (`src/app/ui/ExtractedFieldsView.tsx:80`), `analysisToCsv` columns (`src/app/ui/csv.ts:121`),
  and the LLM `json_schema` + prose prompt (`src/extraction/LlmVisionProvider.ts:54`,`:125`).
- **Two dead fields:** `ExtractedFields.beverageClass` (`src/domain/types.ts:137`) is never
  populated by any provider — `checkCompleteness` always falls through to
  `resolveBeverageClass(...)` (`completeness.ts:138`). Structured `ExtractedFields.alcoholContent`
  (`types.ts:139`) is likewise never populated (`mapRawExtracted` sets only `alcoholContentText`,
  `extractedShape.ts:65`).
- **CSV ≠ JSON:** `analysisToCsv` omits `countryOfOrigin, appellation, vintage, varietal,
  sulfiteDeclaration, ageStatement, commodityStatement` (`csv.ts:121-137`); JSON export dumps the
  whole object (`src/app/VerifyForm.tsx:162`).
- **`warningPrefixIsBold` severity disagrees** between paths: advisory in completeness
  (`completeness.ts:95`) vs hard-fail in the comparator (`src/compare/comparators.ts:234`).

### Brand / producer-name defect
- **Mock blind spot:** `eval/fixtures/cases.json` fixtures omit `name`/`address`/`class`, and the
  mock returns exactly the fixture block (`src/extraction/MockVisionProvider.ts:51`) — so in
  default mock mode these are **always blank**, and completeness always reports them missing.
  (Likely the bulk of the reported symptom; confirm the active `VISION_PROVIDER`.)
- **Prompt conflates brand with producer:** the brand example is itself a company name
  ("OLD TOM DISTILLERY", `LlmVisionProvider.ts:146`), with no rule separating the fanciful brand
  mark from the legally responsible company; `name`/`address`/`commodityStatement` overlap with no
  precedence rule (`LlmVisionProvider.ts:151-161`).
- **Confidence cratering:** `mergeExtracted` collapses brand/name confidence to
  `DISAGREEMENT_CONFIDENCE` (0.3) on benign front/back wording differences and the equal-confidence
  tie-break silently favors the front image (`reconcile.ts:188-192`); `valuesAgree` is harsh on
  short strings. Result surfaces as "low confidence — verify."
- **`class` vs `classType`:** completeness only reads `classType` (`completeness.ts:46`); a benign
  mis-split reads as "missing."

### Law accuracy (domain is mostly correct)
All CFR citations in `src/domain/` are accurate and current; the 2022 TTB-176 renumbering
(Parts 5/7 → `x.63`–`x.70`; Part 4 unchanged) is handled; the warning text is verbatim-correct;
the 0.5% exemption is right. Genuine issues:
- **F1 (bug):** 0.5% warning exemption keys off the never-populated structured `alcoholContent.abv`
  (`completeness.ts:74`) → false "missing warning" on real sub-0.5% reads.
- **F2 (stricter than law):** sulfite modeled mandatory-for-wine
  (`src/domain/labelRequirements.ts:97`) vs CFR conditional ≥10 ppm SO₂ (27 CFR 4.32(e)).
- **F5:** wine ≤14/>14 split needs an ABV that's often missing → defaults to ≤14% and wrongly
  enables the "table wine" carve-out (`src/compare/alcohol.ts:62`, `completeness.ts:139`).
- **F3:** `unknown` class omits `countryOfOrigin` (`labelRequirements.ts:125`) while every concrete
  class includes it.

### UI / accessibility
- Thumbnail is a **non-clickable 64×64 `<img>`** (`VerifyForm.tsx:218`); **no zoom/lightbox exists
  anywhere** (net-new). Batch (`src/app/batch/BatchVerify.tsx:173`) has no preview at all.
- **No "is this label OK?" headline**; completeness banner renders *below* the 16-field table
  (`VerifyForm.tsx:270-281`); jargon throughout ("conf.", "N/A", "COLA application", "27 CFR 16.21").
- Accessibility is otherwise genuinely strong (skip link, focus management, AA contrast tokens,
  44–48 px targets, focus rings, reduced-motion, aria-live).
- **Stale samples promise:** docs claim "one-click samples" but **no sample button exists**;
  mock-mode first run looks broken.

### Repo hygiene
- **`public/samples/` (7 files, ~320 KB) referenced by zero code**; 4 are byte-duplicates of
  `eval/fixtures/images/`. `scripts/generate-demo-labels.cjs` only targets that dir + fixtures.
- Otherwise clean: no committed secrets, no editor/OS cruft, `.gitignore` adequate.

### 2025–2026 legal developments — all PROPOSALS, not law (as of mid-2026)
- Surgeon General Jan 2025 alcohol-cancer advisory (recommendation; only Congress can amend the
  27 U.S.C. 215 / 16.21 text).
- "Alcohol Facts" panel NPRM (Notice 237) and Major Food Allergen NPRM (Notice 238), both
  published 2025-01-17; comment period extended to 2025-08-15; no final rule. Enforce none of these.

---

## 3. Design by workstream

Each workstream lists the change and its **acceptance criteria** (AC).

### A. Reposition to verification-first

One unified screen (no tabs/modes). Order: header → (1) upload with large clickable thumbnails →
(2) always-visible "What does the application say?" form (brand, ABV, beverage class, "warning
required" checkbox) → headline verdict → supporting detail (extraction + completeness + downloads).

- Upload still **auto-extracts** on change (keep the data-entry win).
- **Headline** = Approve / Needs review / Reject from the three checks when application values are
  present; otherwise the plain-language completeness summary.
- Each check row shows a plain-language reason and the CFR basis.

**AC-A1** With an image + brand + ABV + class entered, the screen leads with a single
Approve/Review/Reject banner and three labeled check rows.
**AC-A2** With an image and no application values, the screen leads with the completeness summary
("Complete" / "Needs review: N items" / "Incomplete").
**AC-A3** No tab/mode switch exists; the application form is visible before any read completes.

### B. Fix brand / producer-name / class extraction

- Rewrite the brand rule: **brand = fanciful product mark**; `name` = responsible company parsed
  from the responsibility statement; if identical words, populate both. Replace the company-name
  brand example with a brand≠producer example. State that `name`/`address`/`commodityStatement` are
  parsed from the *same* printed line (don't blank name/address when commodity statement is filled).
- `valuesAgree`: honor containment for short identity fields (`brand`,`name`) so
  "OLD TOM" ⊂ "OLD TOM DISTILLERY" agrees instead of cratering to 0.3.
- `mergeExtracted` tie-break: for producer fields prefer the **more complete** value rather than
  silently favoring the front image; don't collapse confidence on containment-style agreement.
- `class`/`classType`: derive `class` (broad category) deterministically and make completeness fall
  back `classType → class`.
- Add `name`/`address`/`class` to `eval/fixtures/cases.json` so mock + eval exercise them.
- Confirm the active `VISION_PROVIDER` to target the right root cause.

**AC-B1** A fixture/label whose brand mark differs from its producer yields distinct, correct
`brand` and `name` values under a real provider (and the mock fixtures populate both).
**AC-B2** A benign front/back wording difference ("OLD TOM" vs "Old Tom Distillery") no longer
forces brand/name into low-confidence review (unit test on `mergeExtracted`/`valuesAgree`).
**AC-B3** A class/type designation present only as a single printed phrase is reported present
(not "missing") via the `classType → class` fallback.
**AC-B4** Default mock mode shows populated `name`/`address`/`class` for the seeded fixtures.

### C. Legal accuracy (domain + completeness)

- **F1:** parse ABV **once at the ingestion boundary** — populate structured
  `ExtractedFields.alcoholContent` from `alcoholContentText` in `mapRawExtracted` using the existing
  parser. All downstream checks read the structured number; this fixes the 0.5% exemption and
  removes the text-vs-structured trap. (Removes one dead field — see E.)
- **F2:** sulfite is conditional and unmeasurable from a photo. Declaration present → present;
  absent → **`unverifiable` + advisory note** ("required if SO₂ ≥ 10 ppm, 27 CFR 4.32(e)"), never
  `missing`/incomplete. Apply analogously to spirits/malt (5.63(c)/7.63(b)).
- **F5:** when ABV is unknown for a wine, do not apply the ≤14% "table wine" carve-out to a
  possibly->14% wine — route to review/unverifiable.
- **F3:** add conditional `countryOfOrigin` to the `unknown` class for parity.
- **Warning caps/bold consistency:** all-caps = hard requirement (detectable);
  **bold = advisory in both paths** when undetectable (`null`), hard-fail only when confidently
  `false`. Make completeness and the comparator agree.
- **Forward-looking UI note:** a small, collapsed, non-blocking expander listing the 2025
  proposals (cancer warning, Alcohol Facts panel, allergen labeling) marked "proposed, not yet
  required." Mirror in docs. Enforce none of them.

**AC-C1** A label proving <0.5% ABV (text-only ABV) is treated as warning-exempt
(`unverifiable`, not `missing`) — regression test added.
**AC-C2** A sulfite-free wine is **not** marked incomplete; sulfite shows `unverifiable` + advisory.
**AC-C3** A wine with unknown ABV does not silently pass via the table-wine carve-out.
**AC-C4** `warningPrefixIsBold === null` produces the same (advisory) severity in both the
completeness and comparator paths; `=== false` is a hard fail in both.
**AC-C5** No in-force CFR constant in `src/domain/` is reworded; changes are additive/behavioral.
The forward-looking items are display/doc only.

### D. UI ease + click-to-zoom

- **Accessible image lightbox** (new reusable primitive): each thumbnail is a `<button>` opening a
  `role="dialog"` `aria-modal` overlay — Esc + backdrop close, focus trap, focus returned to the
  triggering thumbnail, large close button, near-viewport `object-contain` image.
- **Bigger thumbnails** (~112 px) with a magnifier badge, `cursor-zoom-in`, hover ring.
- **Plain-language headline** + **progressive disclosure** (show the 5 key fields — brand, class/
  type, alcohol, net contents, warning — behind "Show everything we read"); raw JSON stays in
  `<details>`.
- Plainer copy ("AI confidence" not "conf."; inline-explain "COLA application"); explicit
  **"Read again"** button on the result.
- **Unify batch** onto the shared DropZone + thumbnails (batch is retained — it's a named
  stakeholder need).

**AC-D1** Clicking (or Enter/Space on) any thumbnail opens a full-size overlay; Esc and backdrop
close it; focus returns to the thumbnail. Verified by a component test + manual keyboard pass.
**AC-D2** The lightbox traps focus and exposes an accessible name; `prefers-reduced-motion` honored.
**AC-D3** The result leads with a plain-language headline; the long field list is collapsed by
default.
**AC-D4** Batch and single-label screens share the DropZone + thumbnail component.

### E. Single source of truth for the field set

- Introduce **one field registry** (ordered descriptors: `key`, human `label`, value type,
  confidence key, CSV column, UI display group/order). Derive from it: `mapRawExtracted`, the merge
  value/confidence lists, `ExtractedFieldsView` rows, and `analysisToCsv` columns. The LLM
  `json_schema`/prompt keep hand-tuned prose but reference the same keys (not auto-generated —
  per-field guidance needs tuning).
- **Resolve both dead fields:** *remove* `ExtractedFields.beverageClass` (always derived via
  `resolveBeverageClass`, so it carries no information), and *revive* structured
  `ExtractedFields.alcoholContent` by populating it at the ingestion boundary (per C-F1) so it
  becomes load-bearing instead of inert. Net: one field deleted, one made live.
- **JSON and CSV agree:** CSV columns come from the registry, so wine/spirits fields stop being
  dropped.

**AC-E1** Adding a hypothetical field requires editing exactly one registry entry (plus prompt
prose) — demonstrated by the diff shape; no separate edits to mapper/merge/UI/CSV lists.
**AC-E2** `grep` shows `beverageClass` no longer declared on `ExtractedFields`; completeness derives
the class.
**AC-E3** CSV and JSON exports contain the same field keys (test asserts parity).

### F. Repo hygiene + docs ("/init")

- **Delete `public/samples/`**; remove or trim `scripts/generate-demo-labels.cjs` so it no longer
  targets the deleted dir (keep only if it still serves eval-fixture generation).
- **Targeted doc refresh** (not a blunt regenerate): `CLAUDE.md`, `AGENTS.md`, `README.md` to drop
  the false "one-click samples" claim, reflect verify-first + the field registry, and make
  mock-mode messaging honest ("mock recognizes only the built-in test fixtures; set
  `VISION_PROVIDER` to read any image").
- Keep `typecheck → lint → test → eval` green throughout; extend tests (lightbox, registry parity,
  the C law fixes, the B fixtures).

**AC-F1** `public/samples/` is gone; no doc references a samples feature that doesn't exist.
**AC-F2** A fresh reader of `CLAUDE.md`/`AGENTS.md`/`README.md` finds no claim contradicted by code.
**AC-F3** `npm run typecheck && npm run lint && npm test && npm run eval` all pass (eval stays above
the `APPROVE_PRECISION_FLOOR`).

### G. Deployment (deliverable)

The deployed URL needs a real provider (mock can't read arbitrary uploads). Default to
**OpenAI-direct** (one key) for the live demo; **Azure in-tenant** is the documented production
target. Code/config prepared this pass; the actual deploy needs Matt's key/creds.

**AC-G1** The app builds in `output: "standalone"` and runs end-to-end on a real provider with the
documented env vars; README deploy steps are accurate.

---

## 4. Non-goals (YAGNI — explicitly excluded)
- Image deskew / glare / angle correction → stays a friendly re-upload path.
- COLA integration; authentication; persistence of PII.
- New beverage classes beyond the current set.
- Enforcing any proposed-but-not-law rule (cancer warning, Alcohol Facts, allergens) — display +
  docs only.
- Auto-generating the LLM prompt from the field registry.

---

## 5. Verification strategy
- **Unit/integration:** new/updated Vitest specs for `valuesAgree`/`mergeExtracted` (B),
  completeness law fixes (C), registry-driven CSV/JSON parity (E), and the lightbox component
  (jsdom). All offline on the mock.
- **Eval gate:** `npm run eval` must stay above `APPROVE_PRECISION_FLOOR` (0.98) — a false approval
  is the one error class we refuse to ship; new fixtures must not regress it.
- **Manual a11y pass:** keyboard-only walk of upload → zoom → verify → download; verify no
  aria-live/focus double-announcement.
- **Latency:** keep the ~5 s budget; extraction parse-at-boundary adds negligible cost.

---

## 6. Risks & mitigations
- **Domain module is "statutory — don't retune."** Mitigation: C changes are behavioral/additive
  (how completeness *treats* sulfite/exemption) and never reword an in-force CFR constant; the
  verbatim warning test stays green.
- **Field-registry refactor is broad.** Mitigation: land it behind the existing test suite; keep
  the canonical `ExtractedFields` type as the anchor and derive lists from it incrementally.
- **Deleting samples removes the zero-key demo.** Mitigation: honest mock-mode messaging + the
  deployed URL on a real provider is the demo path (accepted trade-off).
- **Eval floor regression from new fixtures.** Mitigation: add fixtures as correct/known cases and
  re-run eval before commit.

---

## 7. Open items to confirm during implementation
- Which `VISION_PROVIDER` Matt has been running (confirms the B root cause; fix lands either way).
- Provider/credentials for the deployed URL (G) — OpenAI key vs Azure creds.
