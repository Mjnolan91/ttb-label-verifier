# Design Spec — Type-Driven Required Fields (Human-Overridable Beverage-Class Selector)

- **Date:** 2026-06-08
- **Status:** Approved (design); proceeding to plan + implementation
- **Scope:** One feature ("Thread B"). A single implementation plan. Builds directly on the shipped
  Feature A Part 2 confirm-to-approve flow (`src/compare/confirm.ts`, `src/app/ui/ConfirmPanel.tsx`,
  `src/app/VerifyForm.tsx`).
- **Companion docs:** Feature A spec `docs/superpowers/specs/2026-06-08-completeness-gated-approval-and-review-worklist-design.md`;
  this Thread B was approved-in-concept and CFR-verified in a prior session (recorded in the project
  memory ledger) — this is the written-up design.

---

## 1. Context

The confirm-to-approve panel asks the human to confirm exactly the elements TTB requires **for the
beverage class** — `mandatoryElementsFor(beverageClass)` ([labelRequirements.ts:132](../../../src/domain/labelRequirements.ts))
drives the field list. But today that class is resolved **entirely from the AI's reading**:
`confirmVerdict(extracted, confirmations)` calls `resolveBeverageClass(classText, abv)` internally
([confirm.ts:100-101](../../../src/compare/confirm.ts)) with **no human hook**, and the class is
rendered as a **static chip** ([ConfirmPanel.tsx:54](../../../src/app/ui/ConfirmPanel.tsx)).

**The gap:** if the AI mis-reads or mis-classifies the class (e.g. reads a fortified wine as a table
wine, or a malt-based product as a spirit), the panel silently checks the **wrong required set** —
the agent reviewing required fields against the wrong CFR matrix — with **no way to correct it**. The
class is the one input that selects both the required-field set *and* the alcohol tolerance, yet it is
the one input the human cannot touch.

**The fix:** make the beverage class an **AI-prefilled, human-overridable** selector at the top of the
confirm panel. The agent confirms or corrects the type; the required-field set (and tolerance)
recompute from the corrected type.

---

## 2. Decisions (settled in brainstorming)

- **Option set — simplified 5, ABV-aware.** The selector offers five plain choices:
  **Distilled spirits · Wine · Malt beverage · Cider · Other / not sure.** The wine **≤14% vs >14%**
  tax-class split is *not* a human pick — it is derived from the ABV in the domain layer (where it
  belongs). Rationale: accessible (five plain options for a 70-year-old agent), and it makes a
  contradictory class/ABV state impossible.
- **Placement — verdict-first.** The verdict card keeps leading; the type sits as a **compact
  selector inside the verdict card** (smallest change to today's layout).
- **Plumbing — reuse `resolveBeverageClass`.** The override flows through the **same** resolver the
  AI path already uses, so a human override and an AI reading resolve through identical, tested logic.
- **CFR refinements — fold in as comment-only notes** (Section 5). No constant values change.

---

## 3. Architecture

### 3.1 Pure layer — `src/compare/confirm.ts`

Add an optional third parameter and a small exported type:

```ts
// The five human-facing class choices. Each value is a token resolveBeverageClass already
// recognizes (alcohol.ts:75-86), so it passes straight through with no parallel mapping.
export type ClassChoice =
  | "distilledSpirits"
  | "wine"          // resolveBeverageClass + ABV picks wineUnder14 / wineOver14
  | "maltBeverage"
  | "cider"
  | "unknown";      // "Other / not sure" — conservative set, tightest tolerance

export function confirmVerdict(
  extracted: ExtractedFields,
  confirmations: Partial<Record<RequirementKey, FieldConfirmation>> = {},
  classOverride?: ClassChoice,          // NEW — when set, overrides the AI-resolved class
): ConfirmVerdict
```

At [confirm.ts:100-101](../../../src/compare/confirm.ts) the resolution becomes:

```ts
const classText = classOverride ?? (extracted.classType?.trim() ? extracted.classType : extracted.class);
const beverageClass = resolveBeverageClass(classText, parseAlcoholText(extracted.alcoholContentText).abv);
```

- `resolveBeverageClass` already returns `wineUnder14`/`wineOver14` from `"wine"` + ABV
  ([alcohol.ts:85-86](../../../src/compare/alcohol.ts)) and `unknown` from `"unknown"`
  ([alcohol.ts:80](../../../src/compare/alcohol.ts)). **No new resolution logic.**
- `ConfirmVerdict` already returns the resolved `beverageClass` ([confirm.ts:56](../../../src/compare/confirm.ts)),
  so the UI can display the resolved fine class and map it back to the coarse selector value.
- **No domain changes.** `mandatoryElementsFor` already covers all six `BeverageClass` values,
  including `cider` → wine ≤14% list and `unknown` → conservative set
  ([labelRequirements.ts:120-129](../../../src/domain/labelRequirements.ts)).
- Re-export `ClassChoice` from `src/compare/index.ts` alongside the existing confirm types.

### 3.2 The selector — `src/app/ui/ConfirmPanel.tsx`

Replace the static class chip ([ConfirmPanel.tsx:53-55](../../../src/app/ui/ConfirmPanel.tsx)) with a
compact, labeled `<select>` inside the verdict tint card:

- **Default selection** = the coarse choice matching `verdict.beverageClass`, via a tiny fine→coarse
  map (`wineUnder14|wineOver14 → "wine"`; the other four 1:1). A new
  `CLASS_CHOICE_LABEL: Record<ClassChoice, string>` (building on the existing `CLASS_DISPLAY_LABEL`
  in [beverageClass.ts](../../../src/app/ui/beverageClass.ts)) supplies the five display strings —
  including **"Other / not sure"** for `unknown`.
- **Affordance:** a quiet "AI read this — change if it's wrong" hint; once the human changes it away
  from the AI's coarse class, show a small **"changed by you"** cue (consistent with the existing
  edited-field treatment).
- **Accessibility (the existing bar):** a real associated `<label>`, ≥44px target, visible focus ring,
  native `<select>` keyboard/screen-reader semantics. Status/affordances never color-only.
- `ConfirmPanel` gains an `onClassChange(choice: ClassChoice)` prop (sibling to the existing
  `onAccept`/`onEdit`/`onMarkMissing`).

### 3.3 State & recompute — `src/app/VerifyForm.tsx`

- Add `classOverride` state beside `confirmations`. Feed it into the `confirmVerdict` `useMemo` and its
  dependency array ([VerifyForm.tsx:80-83](../../../src/app/VerifyForm.tsx)) so the verdict recomputes
  on every type change. Add an `onClassChange` handler that sets it.
- **Recompute behavior (the agreed rule):** `confirmations` are keyed by `RequirementKey` and
  **preserved** across class changes. Only the displayed/required set recomputes:
  - a field that is **still required** under the new class keeps its confirmation state;
  - a **newly-required** field appears unconfirmed (hoisted to "Needs your check");
  - a field **no longer required** simply drops out of the list (its stored confirmation is inert);
  - switching the class **back** restores the prior set with states intact.
- **Reset on new read:** a brand-new image set clears **both** `confirmations` *and* `classOverride`
  (extend the existing reset at [VerifyForm.tsx:110](../../../src/app/VerifyForm.tsx)) so a stale
  override can't carry across labels.

---

## 4. Data flow

```
AI read ─► extracted.class/classType + ABV ─► resolveBeverageClass ─► beverageClass (default)
                                                                          │
                                          agent picks a different type ───┤  (classOverride)
                                                                          ▼
                              resolveBeverageClass(classOverride, abv) ─► beverageClass'
                                                                          ▼
                              mandatoryElementsFor(beverageClass') ─► required set recomputes
                                                                          ▼
                              confirmVerdict reduces fields (confirmations preserved) ─► overall verdict
```

---

## 5. CFR comment-only refinements (`src/domain`)

Per the scope decision, fold the note-only CFR refinements into the domain module **as comment /
citation clarifications only — no constant values, necessity flags, or matrix rows change.** Each is
cross-checked against the authoritative `src/domain/README.md` + `AGENTS.md` before editing and stays
guarded by the existing domain tests.

1. **Brandy age statement** — extend the `AGE_STATEMENT` note
   ([labelRequirements.ts:110-115](../../../src/domain/labelRequirements.ts)) to name **brandy**
   explicitly alongside whisky (27 CFR 5.74 governs age statements for whisky and brandy; the exact
   per-spirit age threshold is verified against the CFR / `src/domain/README.md` at implementation, not
   asserted here).
2. **Cider jurisdiction caveat** — extend the header note (line 31) and the `cider` row comment
   (line 124): cider/wine **< 7% ABV** falls under **FDA** food-labeling jurisdiction (the FAA Act
   defines "wine" for labeling as ≥ 7% ABV), and **malt-based cider** is a malt beverage under
   **Part 7** — the default `cider → wine ≤14%` resolution is the apple/pear ≥7% common case.
3. **Wine ≤14% citation precision** — confirm the wine ≤14% notes cite **27 CFR 4.36** consistently
   (requirement 4.36(a); the ≤14/>14 split and tolerance per 4.36(b)(1)/(c)), matching the tolerance
   matrix in `tolerances.ts` / AGENTS.md.

These are documentation accuracy improvements that travel with the type work; they do **not** alter
any verdict.

---

## 6. Scope boundary & invariants

- **Single-label confirm flow only.** The override lives in `VerifyForm`/`ConfirmPanel`. The **batch**
  screen is bulk CSV with no interactive confirm step → no selector there (out of scope).
- **Eval path unchanged.** The eval harness has no human in the loop, so `classOverride` defaults to
  `undefined` → identical AI resolution → identical results. We re-run `npm run eval` as a **guard**;
  no fixture edits expected.
- **Invariants preserved:** ~5 s latency (override is client-side, no extra round-trip); offline mock
  default; accessibility for a 70+ agent; pure/deterministic comparator + domain; no auth, no PII, no
  COLA. Canonical warning text and CFR tolerance **constants** untouched. `typecheck · lint · test ·
  eval · build` stay green.

---

## 7. Testing

- **Pure (`src/compare/confirm.test.ts`):**
  - Override flips the required set — spirits → wine **adds** sulfite/appellation and **drops** the
    age statement; wine → malt makes ABV **conditional** (optional).
  - Override + ABV resolves wine correctly — `"wine"` + 12% → `wineUnder14`; `"wine"` + 16% →
    `wineOver14` (required set + tolerance follow).
  - `"unknown"` ("Other / not sure") → the conservative set (ABV mandatory) and biases to review.
  - **Confirmation preservation** — a field confirmed under spirits keeps its state after spirits →
    wine and back; a newly-required field is unconfirmed/flagged.
- **Component (`ConfirmPanel.test.tsx` / `VerifyForm.test.tsx`):** changing the selector recomputes
  the panel (a field appears/disappears); the control has a label, is keyboard-operable, and resets to
  the AI reading on a new upload.
- **Regression:** `npm run eval` stays at/above the `APPROVE_PRECISION_FLOOR` (0.98); domain tests
  (`labelRequirements.test.ts`, etc.) stay green after the comment refinements.

---

## 8. Acceptance criteria

- **AC-1** — Overriding the beverage type recomputes the required-field set live in the panel.
- **AC-2** — `"wine"` + ABV resolves to ≤14/>14 correctly for both required set and tolerance.
- **AC-3** — A field's confirmation state is preserved across a type change when it stays required;
  newly-required fields appear unconfirmed; switching back restores.
- **AC-4** — "Other / not sure" yields the conservative `unknown` set (ABV mandatory) and biases to
  review.
- **AC-5** — Default selection matches the AI-resolved class; an "AI read this / changed by you"
  affordance is shown; the control has a visible label, ≥44px target, and visible focus.
- **AC-6** — A new image upload resets the override to the AI reading (and clears confirmations).
- **AC-7** — No domain constant values change; CFR edits are comment/citation-only; domain tests green.
- **AC-8** — `typecheck · lint · test` green; `npm run eval` ≥ 0.98 approve-precision floor.

---

## 9. Out of scope / follow-ups

- Batch-screen type override (no interactive confirm step there).
- Feature B (review worklist) — separate plan.
- Thread C (broader confirm-UI workflow rethink) — separate brainstorm.
- Any change to tolerance/requirement **values** — this feature only changes *who can pick the class*,
  not what each class requires.
