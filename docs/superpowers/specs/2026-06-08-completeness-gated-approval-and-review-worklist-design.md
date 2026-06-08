# Design Spec — Completeness-Gated Approval + Confirm-to-Approve + Review Worklist

- **Date:** 2026-06-08
- **Status:** Approved (design); proceeding to plan + implementation
- **Scope:** Two user-driven features. Phased into two implementation plans: **Plan 1 = Feature A**
  (verdict model + confirm-to-approve UX + eval/test updates), **Plan 2 = Feature B** (review
  worklist), built on A.

---

## 1. Context

Follow-up to the submission-readiness pass. Two requests from the user:

- **A — Approval must consider all required fields, dynamically by type.** Today the
  Approve/Needs-review/Reject verdict is a function of only **3 checks** (brand, alcohol, government
  warning) in `src/compare/verify.ts` → `verifyLabel`. The TTB **completeness** check
  (`src/compare/completeness.ts` over `src/domain/labelRequirements.ts`) already flags every
  required element per beverage type, but it is **informational only** — a label could be missing a
  mandatory field (e.g. net contents, producer address) and still be Approved. The user wants:
  *"we can't approve until all required fields are filled out, dependent on the alcohol type"* and
  *"more fields to verify against"* — and wants it **dynamic** (per type) but **not visually
  overbearing** for a low-tech, 50–73-year-old agent. The agreed mechanism: the AI **pre-fills**
  every required field and the human **confirms-or-corrects** ("the AI fills them in and the user
  type-checks; Tab accepts the grey field").
- **B — Lifecycle after a review + tracking many/concurrent reviews.** Outside batch mode, the user
  wants to know *"what happens after a review"*, *"keep track of multiple reviews"*, and handle
  *"separate reviews happening at the same time"*. Agreed mechanism: a **session worklist** — review
  labels one at a time, record a decision, keep a switchable/resumable list, export it.

**Invariants preserved:** ~5 s latency (confirm is client-side, no extra round-trip); offline mock
default; accessibility for a 70+ agent (visible buttons + Tab accelerator, focus management, status
never color-only); the pure, deterministic comparator/domain; no auth, **no PII**, no COLA. The
canonical warning text and CFR tolerance constants are **not** touched. `typecheck · lint · test ·
eval · build` stay green.

---

## 2. The new verdict model (the core change — Feature A foundation)

Replace the 3-check verdict with a verdict over **every field TTB requires for the beverage type**,
gated by **human confirmation**. New pure function in `src/compare/` (subsumes `verifyLabel`):

```
reviewVerdict(input: {
  beverageClass,                  // resolved type (selects the required set)
  fields: ConfirmableField[],     // one per required element, with extracted value + confidence + confirmation state
}) -> { fields: FieldResult[], overall: "approve" | "review" | "reject" }
```

- **Required set is per type**, from `mandatoryElementsFor(beverageClass)` (existing
  `labelRequirements.ts`). **Mandatory** elements gate; **conditional** ones (sulfites, appellation,
  country-of-origin, age statement) are shown but never block (stay `unverifiable`/neutral).
- **Per-field status (confidence-aware, the agreed rule):**
  - `pass` — read with confidence ≥ `FIELD_REVIEW_CONFIDENCE` (0.7) **and** human-accepted
    (accept = "matches the application"). An accepted field where the human did not edit means
    claimed == extracted → trivially consistent.
  - `review` — low-confidence read (< 0.7), **or** the human edited it to a close-but-different
    value (e.g. a near-miss brand, an ABV inside tolerance-but-not-exact). Never auto-approved.
  - `fail` — a **mandatory** field that is **missing/malformed with high confidence** (readable
    extraction, element genuinely absent — mirrors today's missing-warning = fail), **or** a human
    edit that is a hard mismatch (ABV out of class tolerance, reworded/wrong-format warning,
    different brand). The unreadable-whole-image case still routes to the re-upload path (existing
    `MIN_READABLE_CONFIDENCE` gate), never here.
- **Overall = worst of all field statuses** (reject if any `fail`; else review if any `review` or
  any unconfirmed flagged field; else approve) — the same asymmetric reduction over more fields.
- **Field-specific comparators are reused, not reinvented:** brand → `compareBrand` (fuzzy);
  alcohol → `compareAlcohol` (class-selected tolerance + boundary clamps); warning → `compareWarning`
  (strict, statutory — **not** a free-text field the human can "correct"); other fields
  (net contents, class/type, producer name/address, country) → normalized equality/containment with
  low/edited → review. The warning renders as an auto-checked confirmed/failed item, not an input.
- **Approve is a deliberate human action:** the verdict the model computes is a **suggestion**; the
  UI blocks the Approve control until every flagged (low-confidence/missing/mismatch) field is
  confirmed. The recorded review keeps **both** the AI's suggested verdict and the human's final
  decision (audit trail).

**Confirm-or-correct unifies the application match:** the field holds the AI's label reading by
default. **Accept** (Tab/✓) = "this matches the application." **Edit** = "the application says X"
→ the comparator compares the edited (claimed) value against the original extracted value, producing
review/fail by exception. There is no separate up-front application form for these fields. (If the
agent has no application in hand, accepting all = "the label is complete and the AI read it
correctly"; a visible affordance reflects that this is a completeness confirmation, not a match.)

**Acceptance criteria**
- **AC-1** `reviewVerdict` is pure, deterministic, unit-tested, and gates Approve on the full
  mandatory set for the resolved beverage type; a high-confidence missing mandatory field →
  `reject`; a low-confidence read or close edit → `review`.
- **AC-2** Conditional elements never block approval.
- **AC-3** A model never decides the verdict; all pass/review/fail logic is in pure `src/compare/`.
- **AC-4** `npm run eval` stays green with the approve-precision floor (0.98) satisfied under the new
  model (see §6 Testing).

## 3. Feature A — the confirm-to-approve screen (hybrid, approved as "Option C")

The single-label flow becomes **upload → AI reads → confirm panel → decision.** New
`ConfirmFields` component; `VerifyForm` refactored to drive it.

- **Attention-routing:** flagged fields (low-confidence / missing / mismatch) are **hoisted to the
  top and required** to confirm-or-correct; high-confidence fields render in a compact, visible,
  pre-confirmed list ("tap to change"). Everything stays visible (audit trail); the agent only
  *must* touch the uncertain ones.
- **Affordance:** each flagged field has a visible **✓ Confirm** button (mouse-discoverable for
  low-tech users) **and** accepts **Tab** (accelerator for power users). Edit replaces the value.
- **Dynamic by type:** the field list is derived from `mandatoryElementsFor` + the conditional set —
  a wine shows appellation/sulfites, a spirit shows age, a malt shows the optional-ABV nuance — so
  it is never a fixed wall of inputs.
- **Verify-first preserved:** the screen still *leads with the outcome* — the suggested verdict + the
  one or two things needing a human, then the confirmed list, then the full extraction beneath.

**Acceptance criteria**
- **AC-A1** After a read, the panel shows each required field for the type with its AI value;
  flagged fields are hoisted and block Approve until confirmed; high-confidence fields are visible
  and pre-confirmed.
- **AC-A2** Confirm works by both ✓ button and Tab; editing a value re-runs that field's comparator
  and updates the suggested verdict reactively.
- **AC-A3** The government warning is shown as an auto-evaluated strict check, not a free-text input.
- **AC-A4** Accessibility: visible focus, ≥44px targets, status conveyed by icon+text+color, the
  flagged region announced; no keyboard trap.

## 4. Feature B — the review worklist (Plan 2)

A **session worklist** beside the active review. New `useWorklist` store (React state + a
`localStorage` hook) and a `Worklist` component.

- **Review record:** `{ id, createdAt, productName, images:[{filename,position}], extracted,
  confirmedFields, aiVerdict, humanDecision, note, status }`. `productName` derives from the
  confirmed brand, else the first filename.
- **Status lifecycle:** `in_progress` → one of `approved` / `rejected` / `returned` (bad image —
  re-upload) / `needs_info`. The decision **defaults to the AI's suggested verdict** but is
  overridable; an optional free-text note is captured. Both AI verdict and human decision are stored.
- **Concurrent reviews:** every item retains its own in-progress state (confirmed values, partial
  decision). Selecting a list item loads its state; **New review** starts fresh; **Save & next**
  records the decision and advances. Concurrency without literal multi-window.
- **Persistence:** `localStorage` (survives refresh, stays on the device, never transmitted), with
  **Export worklist (CSV/JSON)** (reuse `analysisToCsv`/`downloadJson`, extended with the decision +
  note columns) and **Clear all**, plus a visible "saved in this browser only" note. Public label
  data only; no PII, no backend.
- **Layout:** a left rail of reviews (status chips + New/Export/Clear) beside the active review;
  collapses to a top strip on narrow screens.

**Acceptance criteria**
- **AC-B1** Completing a review records a decision (defaulting to the AI verdict, overridable) + note;
  the item shows the right status chip and persists across a page refresh.
- **AC-B2** Multiple reviews coexist; switching between an `in_progress` item and another preserves
  each item's confirmed-field state.
- **AC-B3** Export emits one row per review including product, AI verdict, human decision, note, and
  the key fields; Clear all empties the worklist (with confirmation).
- **AC-B4** The store is unit-testable; persistence round-trips through a mocked `localStorage`.

## 5. Architecture & files

- **`src/domain/labelRequirements.ts`** — reuse `mandatoryElementsFor`; add a small
  `gatingElementsFor(class)` (mandatory subset that blocks approval) if it clarifies intent. No CFR
  constant changes.
- **`src/compare/`** — new `reviewVerdict.ts` (pure) composing the existing `compareBrand`/
  `compareAlcohol`/`compareWarning` + per-field equality for the remaining elements; keep
  `verifyLabel` as a thin adapter or migrate callers. Thresholds unchanged.
- **`src/app/`** — `ConfirmFields` (the hybrid panel), `VerifyForm` refactor (upload→read→confirm→
  decide), `useWorklist` + `Worklist` + decision controls. `src/app/ui/` primitives reused.
- **`src/extraction/fieldCatalog.ts`** stays the single field source; the required-field list is the
  intersection of the catalog and the per-type requirements.
- **eval/** — fixtures + harness updated to the new verdict model (see §6).

## 6. Testing strategy (eval impact is first-class)

- **Pure unit tests** for `reviewVerdict`: per-type gating, confidence-aware missing→fail vs
  low-confidence→review, conditional-never-blocks, accept-vs-edit comparison, warning strictness.
- **eval:** the fixtures' `expected` verdicts currently assume the 3-check model. Under the new
  model, an Approve requires the full mandatory set present. The clean/approve fixtures already carry
  brand/class/alcohol/net/name/address/warning, so they should still Approve; the broken-spirits
  fixtures stay reject/review for their existing reason. **Audit every fixture**, adjust `expected`
  where the richer model legitimately changes the outcome, and **keep approve-precision ≥ 0.98**.
- **Component tests (jsdom):** the confirm interaction (flagged field blocks Approve; ✓/Tab confirm;
  edit re-runs the comparator), and worklist persistence (mocked `localStorage`), with the existing
  bounded-retry pattern for async reads.
- `typecheck · lint · test · eval · build` green before each commit; commits in logical units.

## 7. Risks & mitigations

- **Verdict-model change ripples widely** (comparator, `verify`, eval fixtures, route/app tests) →
  the largest risk. Mitigate by keeping `reviewVerdict` pure and exhaustively unit-tested first, then
  migrating the UI, then auditing the eval fixtures in the same plan; the approve-precision floor is
  the backstop against a regression that lets a false approval through.
- **Confirm flow could feel slow at 200–300 labels** → attention-routing means only flagged fields
  need a touch; high-confidence labels are one click. Keep the confirmed list compact.
- **"Confirm" could become rubber-stamping** → confidence routing puts the genuinely-uncertain
  fields front-and-center; the decision still records the human's choice distinctly from the AI's.
- **localStorage holds label readings** → public product data only; visible "stays in this browser",
  Export, and Clear all. No PII, nothing transmitted, no backend.
- **Accessibility of Tab-to-accept** → it is an *accelerator*; the visible ✓ button is the primary,
  discoverable path.

## 8. Out of scope

- No backend, accounts, or server-side persistence; no COLA integration; no multi-user/shared
  worklist. No image deskew/glare correction (re-upload path unchanged). No change to the canonical
  warning text or CFR tolerance values. Batch mode (`/batch`) is unchanged by this work (the worklist
  is the single-screen counterpart to batch, not a replacement).
