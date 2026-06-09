# Type-Driven Required Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-prefilled, human-overridable beverage-class selector to the confirm panel so a reviewer can correct a mis-read class, dynamically recomputing the per-type required-field set (and the alcohol tolerance).

**Architecture:** `confirmVerdict` gains an optional `classOverride` (a 5-value `ClassChoice`) fed to the **existing** `resolveBeverageClass` — no new resolution logic, no domain-constant changes. `ConfirmPanel` renders a compact accessible `<select>` inside the verdict card; `VerifyForm` holds the override state, recomputes the verdict, and resets it on a new read. Plus comment-only CFR citation refinements in the statutory domain module.

**Tech Stack:** Next.js (App Router) · React 19 · TypeScript (strict) · Tailwind v4 · Vitest (+ jsdom for `*.test.tsx`) · @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-08-type-driven-required-fields-design.md`

---

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/compare/confirm.ts` | Pure verdict; resolves the class | Add `ClassChoice` type + optional `classOverride` param |
| `src/compare/index.ts` | Public comparator surface | Export `ClassChoice` |
| `src/app/ui/beverageClass.ts` | UI class→label maps | Add `CLASS_CHOICES`, `CLASS_CHOICE_LABEL`, `coarseClassOf` |
| `src/app/ui/ConfirmPanel.tsx` | Confirm-panel layout | Replace static class chip with the `<select>`; add `onClassChange`/`classOverridden` props |
| `src/app/VerifyForm.tsx` | Single-label screen state | `classOverride` state, recompute, reset-on-new-read, pass props |
| `src/domain/labelRequirements.ts` | CFR requirements matrix | Comment-only citation refinements (NO constant changes) |

Tests live beside each unit (`*.test.ts` / `*.test.tsx`). Build order is bottom-up: pure core → UI model → component → screen → domain comments → full verify.

---

## Task 1: `ClassChoice` + `classOverride` in the pure verdict

**Files:**
- Modify: `src/compare/confirm.ts` (type near line 22; signature + resolution at lines 96-101)
- Modify: `src/compare/index.ts:28-34`
- Test: `src/compare/confirm.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests** — append to `src/compare/confirm.test.ts`:

```ts
describe("confirmVerdict — classOverride drives the required set (Thread B)", () => {
  it("defaults to the AI-resolved class (bourbon -> distilled spirits: age in, appellation out)", () => {
    const v = confirmVerdict(spirits(), {});
    expect(v.beverageClass).toBe("distilledSpirits");
    expect(v.fields.some((f) => f.key === "ageStatement")).toBe(true);
    expect(v.fields.some((f) => f.key === "appellation")).toBe(false);
  });

  it("overriding to wine recomputes the set: appellation + sulfites in, age out", () => {
    // 45% ABV + wine override -> wine > 14%
    const v = confirmVerdict(spirits(), {}, "wine");
    expect(v.beverageClass).toBe("wineOver14");
    expect(v.fields.some((f) => f.key === "appellation")).toBe(true);
    expect(v.fields.some((f) => f.key === "sulfiteDeclaration")).toBe(true);
    expect(v.fields.some((f) => f.key === "ageStatement")).toBe(false);
  });

  it("wine override + ABV picks the tax-class tier (<=14 vs >14)", () => {
    expect(confirmVerdict(spirits({ alcoholContentText: "12% Alc./Vol." }), {}, "wine").beverageClass).toBe("wineUnder14");
    expect(confirmVerdict(spirits({ alcoholContentText: "16% Alc./Vol." }), {}, "wine").beverageClass).toBe("wineOver14");
  });

  it("overriding to malt makes the alcohol statement conditional (optional)", () => {
    const v = confirmVerdict(spirits(), {}, "maltBeverage");
    expect(v.beverageClass).toBe("maltBeverage");
    expect(v.fields.find((f) => f.key === "alcoholContent")!.necessity).toBe("conditional");
  });

  it("'unknown' (Other / not sure) yields the conservative set with mandatory alcohol content", () => {
    const v = confirmVerdict(spirits(), {}, "unknown");
    expect(v.beverageClass).toBe("unknown");
    expect(v.fields.find((f) => f.key === "alcoholContent")!.necessity).toBe("mandatory");
  });

  it("confirmations are honored under an overridden class (keyed by field, not class)", () => {
    const e = spirits({ confidence: { ...spirits().confidence, brand: 0.4 } });
    const v = confirmVerdict(e, { brand: { state: "accepted" } }, "wine");
    expect(v.fields.find((f) => f.key === "brand")!.status).toBe("pass");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/compare/confirm.test.ts`
Expected: FAIL — the override is ignored, e.g. `expected 'distilledSpirits' to be 'wineOver14'`.

- [ ] **Step 3: Add the `ClassChoice` type** — in `src/compare/confirm.ts`, just above the `ConfirmState` type (≈ line 22):

```ts
/** The five human-facing beverage-class choices a reviewer can pick in the confirm panel. Each value
 *  is a token resolveBeverageClass already recognizes (compare/alcohol.ts), so an override feeds the
 *  SAME resolver the AI reading uses — the wine ≤14/>14 split and the unknown fallback come for free. */
export type ClassChoice = "distilledSpirits" | "wine" | "maltBeverage" | "cider" | "unknown";
```

- [ ] **Step 4: Add the param + use it** — replace the signature opening and the resolution (current lines 96-101):

```ts
export function confirmVerdict(
  extracted: ExtractedFields,
  confirmations: Partial<Record<RequirementKey, FieldConfirmation>> = {},
  classOverride?: ClassChoice,
): ConfirmVerdict {
  const aiClassText = extracted.classType?.trim() ? extracted.classType : extracted.class;
  const classText = classOverride ?? aiClassText;
  const beverageClass: BeverageClass = resolveBeverageClass(classText, parseAlcoholText(extracted.alcoholContentText).abv);
```

(The rest of the function body is unchanged.)

- [ ] **Step 5: Export the type** — in `src/compare/index.ts`, add `type ClassChoice` to the confirm export block (lines 28-34):

```ts
export {
  confirmVerdict,
  type ClassChoice,
  type ConfirmState,
  type FieldConfirmation,
  type ConfirmFieldResult,
  type ConfirmVerdict,
} from "./confirm";
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/compare/confirm.test.ts` → Expected: PASS (all blocks).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/compare/confirm.ts src/compare/index.ts src/compare/confirm.test.ts
git commit -m "feat(confirm): classOverride param drives the required-field set"
```

---

## Task 2: coarse class-choice model for the selector

**Files:**
- Modify: `src/app/ui/beverageClass.ts`
- Test: `src/app/ui/beverageClass.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `src/app/ui/beverageClass.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CLASS_CHOICES, CLASS_CHOICE_LABEL, coarseClassOf } from "./beverageClass";

describe("beverage-class selector model", () => {
  it("offers the five coarse choices in order, ending with the 'unknown' fallback", () => {
    expect(CLASS_CHOICES).toEqual(["distilledSpirits", "wine", "maltBeverage", "cider", "unknown"]);
    expect(CLASS_CHOICE_LABEL.unknown).toBe("Other / not sure");
    expect(CLASS_CHOICE_LABEL.wine).toBe("Wine");
  });

  it("collapses both wine tiers to the single 'wine' choice", () => {
    expect(coarseClassOf("wineUnder14")).toBe("wine");
    expect(coarseClassOf("wineOver14")).toBe("wine");
  });

  it("maps the other fine classes 1:1", () => {
    expect(coarseClassOf("distilledSpirits")).toBe("distilledSpirits");
    expect(coarseClassOf("maltBeverage")).toBe("maltBeverage");
    expect(coarseClassOf("cider")).toBe("cider");
    expect(coarseClassOf("unknown")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/ui/beverageClass.test.ts`
Expected: FAIL — `does not provide an export named 'CLASS_CHOICES'`.

- [ ] **Step 3: Implement** — append to `src/app/ui/beverageClass.ts` (the file already imports `type { BeverageClass } from "@/domain"`):

```ts
import type { ClassChoice } from "@/compare";

/** The five human-facing selector choices, in display order (unknown = "Other / not sure"). */
export const CLASS_CHOICES: readonly ClassChoice[] = [
  "distilledSpirits", "wine", "maltBeverage", "cider", "unknown",
];

export const CLASS_CHOICE_LABEL: Record<ClassChoice, string> = {
  distilledSpirits: "Distilled spirits",
  wine: "Wine",
  maltBeverage: "Malt beverage",
  cider: "Cider",
  unknown: "Other / not sure",
};

/** The coarse selector choice for a resolved fine BeverageClass (both wine tiers collapse to "wine"). */
export function coarseClassOf(cls: BeverageClass): ClassChoice {
  switch (cls) {
    case "wineUnder14":
    case "wineOver14":
      return "wine";
    case "distilledSpirits":
    case "maltBeverage":
    case "cider":
    case "unknown":
      return cls;
  }
}
```

> Note: put the new `import type { ClassChoice } from "@/compare";` at the TOP of the file with the existing import, not mid-file. (Shown here inline only to keep the change in one block.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/ui/beverageClass.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: clean (the `switch` is exhaustive over all six `BeverageClass` values).

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/beverageClass.ts src/app/ui/beverageClass.test.ts
git commit -m "feat(ui): coarse class-choice model for the type selector"
```

---

## Task 3: the beverage-type selector in `ConfirmPanel`

**Files:**
- Modify: `src/app/ui/ConfirmPanel.tsx` (imports; props; replace the class chip at lines 53-55)
- Test: `src/app/ui/ConfirmPanel.test.tsx` (import `fireEvent`; add `onClassChange` to `cbs`; 2 tests)

- [ ] **Step 1: Write the failing tests** — in `src/app/ui/ConfirmPanel.test.tsx`: (a) change the testing-library import to include `fireEvent`; (b) add `onClassChange` to `cbs`; (c) append two tests.

```ts
// (a) line 3:
import { cleanup, fireEvent, render, within } from "@testing-library/react";

// (b) line 20:
const cbs = { onAccept: vi.fn(), onEdit: vi.fn(), onMarkMissing: vi.fn(), onClassChange: vi.fn() };

// (c) append inside describe("ConfirmPanel", ...):
  it("renders an accessible beverage-type selector defaulted to the AI's class", () => {
    const q = within(render(<ConfirmPanel verdict={confirmVerdict(spirits(), {})} {...cbs} />).container);
    const select = q.getByLabelText("Beverage type") as HTMLSelectElement;
    expect(select.value).toBe("distilledSpirits");
    expect(q.getByText("Other / not sure")).toBeTruthy();
  });

  it("calls onClassChange when the reviewer picks a different type", () => {
    const onClassChange = vi.fn();
    const q = within(render(<ConfirmPanel verdict={confirmVerdict(spirits(), {})} {...cbs} onClassChange={onClassChange} />).container);
    fireEvent.change(q.getByLabelText("Beverage type"), { target: { value: "wine" } });
    expect(onClassChange).toHaveBeenCalledWith("wine");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/ui/ConfirmPanel.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Beverage type`.

- [ ] **Step 3: Update imports** in `src/app/ui/ConfirmPanel.tsx`:

```ts
// line 1:
import { useId, type Ref } from "react";
// line 2 — add ClassChoice:
import type { ConfirmVerdict, ClassChoice } from "@/compare";
// line 6 — replace the CLASS_DISPLAY_LABEL import:
import { CLASS_CHOICES, CLASS_CHOICE_LABEL, coarseClassOf } from "./beverageClass";
```

- [ ] **Step 4: Add the two props + a select id** — replace the component signature (lines 20-32):

```ts
export function ConfirmPanel({
  verdict,
  onAccept,
  onEdit,
  onMarkMissing,
  onClassChange,
  classOverridden = false,
  headingRef,
}: {
  verdict: ConfirmVerdict;
  onAccept: (key: RequirementKey) => void;
  onEdit: (key: RequirementKey, value: string) => void;
  onMarkMissing: (key: RequirementKey) => void;
  onClassChange: (choice: ClassChoice) => void;
  classOverridden?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const selectId = useId();
```

(Keep the existing `const flagged = …` / `const settled = …` lines right after.)

- [ ] **Step 5: Replace the static class chip** (lines 53-55) with the selector:

```tsx
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label htmlFor={selectId} className="text-xs font-semibold uppercase tracking-wide opacity-80">
              Beverage type
            </label>
            <select
              id={selectId}
              aria-label="Beverage type"
              value={coarseClassOf(verdict.beverageClass)}
              onChange={(e) => onClassChange(e.target.value as ClassChoice)}
              className="min-h-[44px] rounded-field border-2 border-border-strong bg-white px-2 py-1 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              {CLASS_CHOICES.map((c) => (
                <option key={c} value={c}>{CLASS_CHOICE_LABEL[c]}</option>
              ))}
            </select>
            <span className="text-xs opacity-70">
              {classOverridden ? "Changed by you" : "AI read this — change if wrong"}
            </span>
          </div>
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/app/ui/ConfirmPanel.test.tsx` → Expected: PASS.
Run: `npm run typecheck && npm run lint` → Expected: clean (no unused `CLASS_DISPLAY_LABEL` import remains).

- [ ] **Step 7: Commit**

```bash
git add src/app/ui/ConfirmPanel.tsx src/app/ui/ConfirmPanel.test.tsx
git commit -m "feat(ui): beverage-type selector in the confirm panel"
```

---

## Task 4: wire the override into `VerifyForm`

**Files:**
- Modify: `src/app/VerifyForm.tsx` (import; state; useMemo; handler; reset at line 110; ConfirmPanel props)
- Test: `src/app/VerifyForm.test.tsx` (one integration test)

- [ ] **Step 1: Write the failing test** — append inside `describe("VerifyForm — confirm-to-approve", …)` in `src/app/VerifyForm.test.tsx`:

```ts
it("changing the beverage type recomputes the required-field set", ASYNC, async () => {
  mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
  const { container } = render(<VerifyForm />);
  const q = within(container);
  dropLabelImage(container);
  await q.findByText("Confirm the required fields");
  // Bourbon -> distilled spirits: Age statement is required, Appellation is not.
  expect(q.getByText("Age statement")).toBeTruthy();
  expect(q.queryByText("Appellation of origin")).toBeNull();
  // Override to Wine (45% ABV -> wine > 14%): Appellation joins the set, Age statement leaves it.
  fireEvent.change(q.getByLabelText("Beverage type"), { target: { value: "wine" } });
  expect(await q.findByText("Appellation of origin")).toBeTruthy();
  expect(q.queryByText("Age statement")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/VerifyForm.test.tsx -t "recomputes"`
Expected: FAIL — `onClassChange` is not yet supplied, so changing the select throws (`onClassChange is not a function`) / "Appellation of origin" never appears.

- [ ] **Step 3: Import the type** — `src/app/VerifyForm.tsx` line 14:

```ts
import { confirmVerdict, type ConfirmVerdict, type FieldConfirmation, type ClassChoice } from "@/compare";
```

- [ ] **Step 4: Add the override state** — after the `confirmations` state (line 50):

```ts
  const [classOverride, setClassOverride] = useState<ClassChoice | undefined>(undefined);
```

- [ ] **Step 5: Feed it into the verdict + deps** — replace the `verdict` useMemo (lines 80-83):

```ts
  const verdict: ConfirmVerdict | null = useMemo(
    () => (state === "done" && response?.readable ? confirmVerdict(response.extracted, confirmations, classOverride) : null),
    [state, response, confirmations, classOverride],
  );
```

- [ ] **Step 6: Add the change handler** — after the `markMissing` handler (line 87):

```ts
  const changeClass = (choice: ClassChoice) => setClassOverride(choice);
```

- [ ] **Step 7: Reset the override on a new read** — at line 110, alongside the confirmations reset:

```ts
      setConfirmations({});
      setClassOverride(undefined);
```

- [ ] **Step 8: Pass the props to `ConfirmPanel`** — replace the render block (lines 290-296):

```tsx
            <ConfirmPanel
              verdict={verdict}
              onAccept={accept}
              onEdit={edit}
              onMarkMissing={markMissing}
              onClassChange={changeClass}
              classOverridden={classOverride !== undefined}
              headingRef={verdictHeadingRef}
            />
```

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run src/app/VerifyForm.test.tsx` → Expected: PASS (new + existing).
Run: `npm run typecheck` → Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/app/VerifyForm.tsx src/app/VerifyForm.test.tsx
git commit -m "feat(verify): wire beverage-type override + recompute, reset on new read"
```

---

## Task 5: comment-only CFR refinements (statutory domain module)

**Files:**
- Modify: `src/domain/labelRequirements.ts` (comments + `note` strings only — NO `necessity`, key, or matrix-row value changes)

> These touch the human-trusted domain module. They are documentation/citation refinements only; cross-check each against `AGENTS.md` (wine table + "Citations note") and `src/domain/README.md` before editing. No test asserts these `.note` strings (verified), so behavior is unchanged.

- [ ] **Step 1: Verify the citations (read-only)** — open `AGENTS.md` (the alcohol-tolerance matrix rows + the 2022 "Citations note") and `src/domain/README.md`. Confirm: wine = `4.36` (NOT renumbered), tolerance `4.36(b)(1)`, 14% clamp `4.36(c)`; Parts 5/7 renumbered (age `5.74`); FAA Act defines wine for labeling as ≥ 7% ABV. No code change in this step.

- [ ] **Step 2: Brandy in the age-statement note** — `AGE_STATEMENT.note` (lines 110-115). Replace:

```ts
  note: "Mandatory for whisky < 4 years and certain spirits (27 CFR 5.74).",
```
with:
```ts
  note: "Mandatory for whisky < 4 years and for brandy and certain other spirits (27 CFR 5.74).",
```

- [ ] **Step 3: Wine ≤14% citation precision** — `ALC_WINE_UNDER14.note` (lines 79-84). Replace:

```ts
  note: 'Numeric % Alc./Vol., OR a "table wine"/"light wine" designation may stand in for it on wine <= 14% ABV (27 CFR 4.36(a)).',
```
with:
```ts
  note: 'Numeric % Alc./Vol., OR a "table wine"/"light wine" designation may stand in for it on wine <= 14% ABV (27 CFR 4.36(a); tolerance 4.36(b)(1), 14% tax-class clamp 4.36(c)).',
```

- [ ] **Step 4: Cider jurisdiction caveat — header note** (line 31). Replace:

```
 *  - `cider` is treated as wine (its default resolution in tolerances.ts).
```
with:
```
 *  - `cider` is treated as wine (its default resolution in tolerances.ts) — the common apple/pear
 *    case at >= 7% ABV. Not modeled here: cider/wine < 7% ABV falls under FDA food-labeling
 *    jurisdiction (the FAA Act defines "wine" for labeling as >= 7% ABV), and malt-based cider is a
 *    malt beverage under Part 7.
```

- [ ] **Step 5: Cider jurisdiction caveat — row comment** (line 124). Replace:

```ts
  cider: WINE_UNDER14, // resolves to wine <= 14% by default (see tolerances.ts)
```
with:
```ts
  cider: WINE_UNDER14, // apple/pear cider >= 7% ABV -> wine <= 14% (see tolerances.ts); < 7% ABV is FDA-regulated, malt-based cider is Part 7 (see header note)
```

- [ ] **Step 6: Run to verify nothing broke**

Run: `npx vitest run src/domain && npm run typecheck && npm run lint`
Expected: PASS — comment/note-only change, no behavior difference.

- [ ] **Step 7: Commit**

```bash
git add src/domain/labelRequirements.ts
git commit -m "docs(domain): comment-only CFR refinements (brandy, cider <7% FDA/Part 7, wine 4.36 cite)"
```

---

## Task 6: full verification + eval guard

**Files:** none (verification; commit only if a fix is needed)

- [ ] **Step 1: Run the full feedback loop**

Run: `npm run typecheck && npm run lint && npm test && npm run eval`
Expected:
- `typecheck` — clean.
- `lint` — 0 errors (pre-existing `_`-prefixed-arg warnings are fine).
- `test` — all pass (existing + the new Task 1/2/3/4 tests).
- `eval` — `APPROVE precision … -> PASS` (≥ 0.98 floor). The override defaults to `undefined` in the eval (no human in the loop), so resolution is identical to today; no fixture edits expected.

- [ ] **Step 2: If `eval` or `lint` surfaces a fixable issue**, fix it and commit:

```bash
git add -A
git commit -m "fix: address verification finding in type-driven required fields"
```

- [ ] **Step 3 (manual smoke check, optional):** `npm run dev`, drop a fixture label, change the **Beverage type** selector, and confirm the required-field list recomputes (e.g. spirits → wine adds "Appellation of origin", drops "Age statement"), and that a fresh upload resets the selector to the AI's reading.

---

## Self-review notes (coverage against the spec's acceptance criteria)

- **AC-1** (override recomputes the set) — Task 1 (pure) + Task 4 (integration). ✓
- **AC-2** (wine + ABV → ≤14/>14) — Task 1 "picks the tax-class tier". ✓
- **AC-3** (confirmations preserved across a type change) — by construction: `changeClass` only sets `classOverride`, never touches `confirmations`; Task 1 "confirmations honored under an overridden class" locks the pure behavior. ✓
- **AC-4** ("Other / not sure" → conservative `unknown` set) — Task 1. ✓
- **AC-5** (default = AI class; affordance; a11y) — Task 3 (default selection + labelled control + options); the "Changed by you" cue, `min-h-[44px]`, and visible focus ring are in the implementation. ✓
- **AC-6** (new upload resets the override) — Task 4 Step 7 (`setClassOverride(undefined)` beside the existing confirmations reset); covered by code + the optional manual smoke check. No dedicated automated test (the reset rides the same path the existing `setConfirmations({})` reset is trusted on).
- **AC-7** (no constant changes; comment-only; domain tests green) — Task 5 (comment/note-only) + Step 6. ✓
- **AC-8** (typecheck/lint/test/eval green) — Task 6. ✓

No placeholders; types are consistent across tasks (`ClassChoice`, `coarseClassOf`, the 3-arg `confirmVerdict`, `onClassChange`/`classOverridden`).
