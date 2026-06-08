# Feature A Part 2 — Confirm-to-Approve UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single screen's static 3-input application form with the spec's confirm-to-approve panel — the AI pre-fills every TTB-required field for the resolved beverage type, the human confirms (Tab/✓) or corrects each, and a label cannot be Approved until every flagged field is confirmed.

**Architecture:** A new PURE verdict model (`src/compare/confirm.ts`) computes, per required element, a confidence-aware suggested status (pass/review/fail) and whether it still needs a human touch, then reduces to an overall verdict + an `awaitingConfirmation` gate. It reuses the existing CFR comparators (`compareBrand`/`compareAlcohol`), the warning evaluator, and the per-class requirements matrix (`mandatoryElementsFor`) — no CFR constants change. A presentational `ConfirmPanel` (with a `ConfirmFieldRow`) renders the fields (flagged ones hoisted), and `VerifyForm` is refactored to drive it: upload → AI reads → confirm panel → gated verdict.

**Tech Stack:** Next.js (App Router) + React 19 + TypeScript (strict) + Tailwind v4 + Vitest (`@testing-library/react`, jsdom for `*.test.tsx`).

---

## Naming note (read first)

The spec (§2) names the new pure function `reviewVerdict`, but `src/compare/reviewVerdict.ts` already exists (Part 1's `combinedVerdict`). To avoid a collision, this plan uses **`confirmVerdict`** in a new file **`src/compare/confirm.ts`**. Same semantics as the spec's `reviewVerdict({beverageClass, fields})`, different name.

## Two deliberate refinements of the spec's literal wording (carry these into the code)

1. **Accepting a low-confidence field upgrades it to `pass`.** The spec §2 literally says "pass — read with confidence ≥ 0.7 AND human-accepted" and "review — low-confidence read (< 0.7)". Read literally, a low-confidence field could never reach approve even after the human verifies it — defeating confirm-to-approve. We treat the per-field statuses in §2 as the AI's *suggestion before confirmation*; the human accepting a low-confidence read (after looking at the label) upgrades it to `pass`. A field the human does not touch and that the AI read with high confidence is pre-confirmed `pass`.
2. **An absent mandatory field is a *flagged, blocking* `review` suggestion, not an immediate `fail`.** The human resolves it by either entering the value (the AI missed it) or pressing **Not on the label**, which escalates to `fail` → reject (the spec's "escalates a confirmed-missing element from review → reject"). We don't auto-`fail` on absence because there is no confidence-of-absence signal.

Decision **recording/persistence** (the worklist, `humanDecision`, status lifecycle) is **Feature B — out of scope here.** Part 2 delivers the panel, the per-field model, the Approve gate, and the reactive verdict; clicking the gated Approve sets a **local, non-persisted** session decision.

---

## File Structure

- **Create** `src/compare/confirm.ts` — the pure `confirmVerdict` model: `ConfirmState`, `FieldConfirmation`, `ConfirmFieldResult`, `ConfirmVerdict`, `confirmVerdict()`. One responsibility: turn `(extracted, confirmations)` into a per-field + overall verdict. Reuses comparators, the warning/absent-alcohol classifiers, and `mandatoryElementsFor`.
- **Create** `src/compare/confirm.test.ts` — exhaustive pure unit tests for `confirmVerdict`.
- **Modify** `src/compare/completeness.ts` — export `fieldFor`, and extract the warning + absent-alcohol classification into exported pure helpers (`evaluateWarningElement`, `evaluateAbsentAlcohol`) so `confirm.ts` reuses the exact CFR-faithful logic (DRY). Behavior unchanged.
- **Modify** `src/compare/index.ts` — re-export the confirm surface.
- **Create** `src/app/ui/ConfirmFieldRow.tsx` — one required-element row: AI value, confidence, ✓ Confirm (+ Tab-accept), inline edit, "Not on the label".
- **Create** `src/app/ui/ConfirmPanel.tsx` — orchestrates the rows: flagged fields hoisted into a "Needs your check" group, the rest in a compact pre-confirmed group; renders the gated headline + decision controls.
- **Create** `src/app/ui/ConfirmFieldRow.test.tsx` and `src/app/ui/ConfirmPanel.test.tsx` — component tests.
- **Modify** `src/app/VerifyForm.tsx` — remove the 3-input application form + `claimed` state; add `confirmations` state; drive `ConfirmPanel`; headline + live region + focus from `confirmVerdict`; exports carry confirmed values.
- **Modify** `src/app/VerifyForm.test.tsx` — replace the claimed-form tests with confirm-flow tests.
- **Modify** `src/app/ResultView.tsx` — accept a `ConfirmVerdict` (or keep as the field-card renderer fed by the confirm fields). See Task 6.

---

### Task 1: Export the reusable classifiers from `completeness.ts` (refactor, no behavior change)

**Files:**
- Modify: `src/compare/completeness.ts`
- Test: `src/compare/completeness.test.ts` (must stay green unchanged)

- [ ] **Step 1: Make `fieldFor` exported**

In `src/compare/completeness.ts`, change the signature line:

```ts
/** The extracted value + confidence backing a requirement key. Exported for reuse by confirm.ts. */
export function fieldFor(key: RequirementKey, e: ExtractedFields): { value?: string; confidence?: number } {
```

- [ ] **Step 2: Export the warning classifier**

Rename `evalWarning` → `evaluateWarningElement` and export it (update its one caller in `checkCompleteness`):

```ts
export function evaluateWarningElement(spec: RequirementSpec, e: ExtractedFields): CompletenessElement {
```

In `checkCompleteness`, update the call site:

```ts
    if (spec.key === "governmentWarning") return evaluateWarningElement(spec, extracted);
```

- [ ] **Step 3: Export the absent-alcohol classifier**

Rename `evalAbsentAlcohol` → `evaluateAbsentAlcohol` and export it; update its call site in `checkCompleteness`:

```ts
export function evaluateAbsentAlcohol(spec: RequirementSpec, e: ExtractedFields, cls: BeverageClass): CompletenessElement {
```

```ts
    if (spec.key === "alcoholContent") {
      return evaluateAbsentAlcohol(spec, extracted, beverageClass);
    }
```

- [ ] **Step 4: Run the completeness suite — behavior must be unchanged**

Run: `npx vitest run src/compare/completeness.test.ts`
Expected: PASS (same count as before; this is a pure rename + export).

- [ ] **Step 5: Commit**

```bash
git add src/compare/completeness.ts
git commit -m "refactor(compare): export fieldFor + warning/absent-alcohol classifiers for reuse"
```

---

### Task 2: The pure `confirmVerdict` model (`src/compare/confirm.ts`)

**Files:**
- Create: `src/compare/confirm.ts`
- Test: `src/compare/confirm.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/compare/confirm.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { confirmVerdict } from "./confirm";
import { CANONICAL_GOVERNMENT_WARNING, type ExtractedFields } from "@/domain";

/** A clean, high-confidence spirits extraction with every mandatory element present. */
function spirits(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brand: "Old Tom Distillery",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    name: "Old Tom Distillery",
    address: "Louisville, KY",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: {
      brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96,
      name: 0.95, address: 0.95, warningText: 0.96,
    },
    ...overrides,
  };
}

describe("confirmVerdict — pre-confirmed high-confidence labels", () => {
  it("a clean high-confidence label needs no confirmation and the suggested verdict is approve", () => {
    const v = confirmVerdict(spirits(), {});
    expect(v.awaitingConfirmation).toBe(false);
    expect(v.overall).toBe("approve");
    // mandatory present high-confidence fields are pre-confirmed pass
    const brand = v.fields.find((f) => f.key === "brand")!;
    expect(brand.status).toBe("pass");
    expect(brand.needsConfirmation).toBe(false);
  });

  it("conditional absent elements never block (AC-2)", () => {
    const v = confirmVerdict(spirits(), {});
    const age = v.fields.find((f) => f.key === "ageStatement");
    expect(age).toBeDefined();
    expect(age!.necessity).toBe("conditional");
    expect(age!.needsConfirmation).toBe(false);
  });
});

describe("confirmVerdict — low-confidence reads flag for confirmation", () => {
  it("a low-confidence brand is flagged + blocks approve until accepted, then passes", () => {
    const e = spirits({ confidence: { ...spirits().confidence, brand: 0.4 } });
    const before = confirmVerdict(e, {});
    const brand = before.fields.find((f) => f.key === "brand")!;
    expect(brand.flagged).toBe(true);
    expect(brand.needsConfirmation).toBe(true);
    expect(before.awaitingConfirmation).toBe(true);
    expect(before.overall).toBe("review");

    const after = confirmVerdict(e, { brand: { state: "accepted" } });
    const brandAfter = after.fields.find((f) => f.key === "brand")!;
    expect(brandAfter.status).toBe("pass");
    expect(after.awaitingConfirmation).toBe(false);
    expect(after.overall).toBe("approve");
  });
});

describe("confirmVerdict — missing mandatory fields", () => {
  it("an absent mandatory field is a flagged review until resolved", () => {
    const e = spirits({ netContents: undefined, confidence: { ...spirits().confidence, netContents: undefined } });
    const v = confirmVerdict(e, {});
    const net = v.fields.find((f) => f.key === "netContents")!;
    expect(net.status).toBe("review");
    expect(net.needsConfirmation).toBe(true);
    expect(v.awaitingConfirmation).toBe(true);
  });

  it("confirming an absent mandatory field as missing escalates to reject", () => {
    const e = spirits({ netContents: undefined });
    const v = confirmVerdict(e, { netContents: { state: "missing" } });
    const net = v.fields.find((f) => f.key === "netContents")!;
    expect(net.status).toBe("fail");
    expect(net.needsConfirmation).toBe(false);
    expect(v.overall).toBe("reject");
  });

  it("entering a value for an absent mandatory field resolves it to pass", () => {
    const e = spirits({ netContents: undefined });
    const v = confirmVerdict(e, { netContents: { state: "edited", editedValue: "750 mL" } });
    const net = v.fields.find((f) => f.key === "netContents")!;
    expect(net.status).toBe("pass");
    expect(v.awaitingConfirmation).toBe(false);
  });
});

describe("confirmVerdict — edits re-run the field comparator", () => {
  it("a hard ABV mismatch on edit fails the field (reject)", () => {
    const e = spirits(); // label reads 45%
    const v = confirmVerdict(e, { alcoholContent: { state: "edited", editedValue: "60% Alc./Vol." } });
    const alc = v.fields.find((f) => f.key === "alcoholContent")!;
    expect(alc.status).toBe("fail");
    expect(v.overall).toBe("reject");
  });

  it("a close-but-different brand edit is review, not fail", () => {
    const e = spirits(); // label reads "Old Tom Distillery"
    const v = confirmVerdict(e, { brand: { state: "edited", editedValue: "Old Tom Distillary" } });
    const brand = v.fields.find((f) => f.key === "brand")!;
    expect(brand.status).toBe("review");
    expect(v.overall).toBe("review");
  });
});

describe("confirmVerdict — the government warning is auto-evaluated, never free-text", () => {
  it("a title-case (not all-caps) warning prefix fails (reject), not confirmable", () => {
    const e = spirits({ warningPrefixIsAllCaps: false });
    const v = confirmVerdict(e, {});
    const w = v.fields.find((f) => f.key === "governmentWarning")!;
    expect(w.editable).toBe(false);
    expect(w.status).toBe("fail");
    expect(v.overall).toBe("reject");
  });

  it("an undetectable-bold warning is a flagged review the human can accept to pass", () => {
    const e = spirits({ warningPrefixIsBold: null });
    const before = confirmVerdict(e, {});
    const w = before.fields.find((f) => f.key === "governmentWarning")!;
    expect(w.status).toBe("review");
    expect(w.needsConfirmation).toBe(true);
    const after = confirmVerdict(e, { governmentWarning: { state: "accepted" } });
    expect(after.fields.find((f) => f.key === "governmentWarning")!.status).toBe("pass");
    expect(after.awaitingConfirmation).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/compare/confirm.test.ts`
Expected: FAIL with "Cannot find module './confirm'".

- [ ] **Step 3: Implement `src/compare/confirm.ts`**

```ts
/**
 * confirm.ts — the confirm-to-approve verdict model (Feature A Part 2).
 *
 * Pure and deterministic. Given the AI's extracted fields and the human's per-field confirmations,
 * it computes, for every element TTB requires for the resolved beverage type, a confidence-aware
 * status (pass/review/fail) plus whether the element still needs a human touch — and reduces those
 * to an overall verdict gated on confirmation. It REUSES the CFR comparators and the warning/
 * absent-alcohol classifiers (no CFR constant is duplicated). The government warning is auto-
 * evaluated (never a free-text field). See docs/superpowers/plans/2026-06-08-feature-a-part2-*.
 */
import type { BeverageClass, ExtractedFields, RequirementKey } from "@/domain";
import { mandatoryElementsFor } from "@/domain";
import type { FieldStatus, OverallVerdict } from "./types";
import { fieldFor, evaluateWarningElement, evaluateAbsentAlcohol } from "./completeness";
import { compareBrand, compareAlcohol } from "./comparators";
import { resolveBeverageClass, parseAlcoholText } from "./alcohol";
import { FIELD_REVIEW_CONFIDENCE } from "./thresholds";
import { normalizeText } from "./text";

/** The human's action on a field. */
export type ConfirmState = "unconfirmed" | "accepted" | "edited" | "missing";

export interface FieldConfirmation {
  state: ConfirmState;
  /** Present only when state === "edited": the value the human entered. */
  editedValue?: string;
}

export interface ConfirmFieldResult {
  key: RequirementKey;
  label: string;
  necessity: "mandatory" | "conditional";
  /** The AI's reading of this element ("" when nothing was read). */
  aiValue: string;
  /** The value the verdict is based on (edited value when edited, else the AI value). */
  value: string;
  /** Model confidence in the AI reading, when applicable. */
  confidence?: number;
  /** Whether the human can edit/confirm this element (the warning is auto-evaluated, never editable). */
  editable: boolean;
  /** Intrinsically uncertain/blocking before any human action (low-conf / missing-mandatory / bold-undetectable). Drives hoisting. */
  flagged: boolean;
  /** Flagged AND not yet resolved by the human -> the Approve control stays blocked. */
  needsConfirmation: boolean;
  /** The human's action so far. */
  state: ConfirmState;
  /** Per-field verdict given the AI read + human action. */
  status: FieldStatus;
  /** Plain-language explanation for the card. */
  reason: string;
}

export interface ConfirmVerdict {
  beverageClass: BeverageClass;
  fields: ConfirmFieldResult[];
  /** Overall verdict given current confirmations: reject if any fail; else review if any review; else approve. */
  overall: OverallVerdict;
  /** True while any flagged field is still unconfirmed — the Approve control stays blocked. */
  awaitingConfirmation: boolean;
}

const abvFromText = (e: ExtractedFields) => parseAlcoholText(e.alcoholContentText).abv;

/** Compare a human EDIT (claimed) against the AI reading (extracted) using the field's comparator. */
function statusForEdit(
  key: RequirementKey,
  edited: string,
  aiValue: string,
  extracted: ExtractedFields,
  beverageClass: BeverageClass,
): { status: FieldStatus; reason: string } {
  if (key === "brand") {
    const r = compareBrand({ claimed: edited, extracted: aiValue });
    return { status: r.status, reason: r.reason };
  }
  if (key === "alcoholContent") {
    const r = compareAlcohol({
      claimedText: edited,
      extractedText: aiValue,
      claimedClass: extracted.classType,
      extractedClass: extracted.classType,
      beverageClass,
    });
    return { status: r.status, reason: r.reason };
  }
  // Generic fields (net contents, name, address, country, …): normalized equality, else review.
  if (normalizeText(edited) === normalizeText(aiValue)) {
    return { status: "pass", reason: "Your value matches what the AI read off the label." };
  }
  return {
    status: "review",
    reason: "Your value differs from what the AI read — a person should confirm which is right.",
  };
}

export function confirmVerdict(
  extracted: ExtractedFields,
  confirmations: Partial<Record<RequirementKey, FieldConfirmation>> = {},
): ConfirmVerdict {
  const classText = extracted.classType?.trim() ? extracted.classType : extracted.class;
  const beverageClass: BeverageClass = resolveBeverageClass(classText, abvFromText(extracted));

  const fields: ConfirmFieldResult[] = mandatoryElementsFor(beverageClass).map((spec): ConfirmFieldResult => {
    const c = confirmations[spec.key] ?? { state: "unconfirmed" as ConfirmState };

    // ---- The government warning: auto-evaluated, not editable. ----
    if (spec.key === "governmentWarning") {
      const el = evaluateWarningElement(spec, extracted);
      const base = {
        key: spec.key, label: spec.label, necessity: spec.necessity,
        aiValue: el.value ?? "", value: el.value ?? "", confidence: extracted.confidence.warningText,
        editable: false, state: c.state,
      };
      if (el.status === "missing" || el.status === "malformed") {
        return { ...base, flagged: true, needsConfirmation: false, status: "fail", reason: el.detail };
      }
      if (el.status === "unverifiable") {
        // <0.5% ABV exemption — not required, treat as satisfied.
        return { ...base, flagged: false, needsConfirmation: false, status: "pass", reason: el.detail };
      }
      // present. Bold undetectable (null) needs a human to confirm the prefix is bold.
      if (extracted.warningPrefixIsBold === null && c.state !== "accepted") {
        return { ...base, flagged: true, needsConfirmation: true, status: "review", reason: el.detail };
      }
      return { ...base, flagged: extracted.warningPrefixIsBold === null, needsConfirmation: false, status: "pass", reason: el.detail };
    }

    // ---- Every other element. ----
    const { value: aiRaw, confidence } = fieldFor(spec.key, extracted);
    const aiValue = (aiRaw ?? "").trim();
    const present = aiValue !== "";
    const lowConf = present && (confidence === undefined || confidence < FIELD_REVIEW_CONFIDENCE);
    const base = {
      key: spec.key, label: spec.label, necessity: spec.necessity,
      aiValue, confidence, editable: true, state: c.state,
    };

    // Human edited the value: re-run the comparator (edited = claimed, aiValue = extracted).
    if (c.state === "edited") {
      const edited = (c.editedValue ?? "").trim();
      if (edited === "") {
        // Cleared to empty == "missing".
        const status: FieldStatus = spec.necessity === "mandatory" ? "fail" : "pass";
        return { ...base, value: "", flagged: true, needsConfirmation: false, status,
          reason: spec.necessity === "mandatory"
            ? "Confirmed not on the label — a required element for this beverage type is missing."
            : "Not present (only required in certain cases)." };
      }
      const { status, reason } = statusForEdit(spec.key, edited, aiValue, extracted, beverageClass);
      return { ...base, value: edited, flagged: status !== "pass", needsConfirmation: false, status, reason };
    }

    // Human marked it missing.
    if (c.state === "missing") {
      const status: FieldStatus = spec.necessity === "mandatory" ? "fail" : "pass";
      return { ...base, value: "", flagged: true, needsConfirmation: false, status,
        reason: spec.necessity === "mandatory"
          ? "Confirmed not on the label — a required element for this beverage type is missing."
          : "Not present (only required in certain cases)." };
    }

    // Human accepted the AI reading (only meaningful when something was read).
    if (c.state === "accepted" && present) {
      return { ...base, value: aiValue, flagged: lowConf, needsConfirmation: false, status: "pass",
        reason: "Confirmed: matches the application." };
    }

    // ---- Unconfirmed (the AI's suggestion). ----
    if (present) {
      if (lowConf) {
        return { ...base, value: aiValue, flagged: true, needsConfirmation: true, status: "review",
          reason: "The AI wasn't fully sure it read this correctly — confirm it or type the right value." };
      }
      return { ...base, value: aiValue, flagged: false, needsConfirmation: false, status: "pass",
        reason: "Read confidently from the label." };
    }

    // Absent. Alcohol content is class-specific (table-wine substitution; malt optional).
    if (spec.key === "alcoholContent") {
      const el = evaluateAbsentAlcohol(spec, extracted, beverageClass);
      if (el.status === "present" || el.status === "unverifiable") {
        return { ...base, value: "", flagged: false, needsConfirmation: false, status: "pass", reason: el.detail };
      }
      // missing & mandatory
      return { ...base, value: "", flagged: true, needsConfirmation: true, status: "review",
        reason: "Not read from the label — type it if it's there, or mark it missing." };
    }
    if (spec.necessity === "mandatory") {
      return { ...base, value: "", flagged: true, needsConfirmation: true, status: "review",
        reason: "Not read from the label — type it if it's there, or mark it missing." };
    }
    // Conditional absent — never blocks.
    return { ...base, value: "", flagged: false, needsConfirmation: false, status: "pass", reason: spec.note };
  });

  const statuses = fields.map((f) => f.status);
  const overall: OverallVerdict = statuses.includes("fail")
    ? "reject"
    : statuses.includes("review")
      ? "review"
      : "approve";
  const awaitingConfirmation = fields.some((f) => f.needsConfirmation);
  return { beverageClass, fields, overall, awaitingConfirmation };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/compare/confirm.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/compare/confirm.ts src/compare/confirm.test.ts
git commit -m "feat(compare): pure confirm-to-approve verdict model (confirmVerdict)"
```

---

### Task 3: Export the confirm surface

**Files:**
- Modify: `src/compare/index.ts`

- [ ] **Step 1: Add the re-export**

Append to `src/compare/index.ts`:

```ts
export {
  confirmVerdict,
  type ConfirmState,
  type FieldConfirmation,
  type ConfirmFieldResult,
  type ConfirmVerdict,
} from "./confirm";
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/compare/index.ts
git commit -m "feat(compare): export the confirm-to-approve surface"
```

---

### Task 4: `ConfirmFieldRow` — one confirmable element

**Files:**
- Create: `src/app/ui/ConfirmFieldRow.tsx`
- Test: `src/app/ui/ConfirmFieldRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/ui/ConfirmFieldRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ConfirmFieldRow } from "./ConfirmFieldRow";
import type { ConfirmFieldResult } from "@/compare";

afterEach(cleanup);

const field = (o: Partial<ConfirmFieldResult> = {}): ConfirmFieldResult => ({
  key: "brand", label: "Brand name", necessity: "mandatory",
  aiValue: "Old Tom Distillery", value: "Old Tom Distillery", confidence: 0.4,
  editable: true, flagged: true, needsConfirmation: true, state: "unconfirmed",
  status: "review", reason: "The AI wasn't fully sure.", ...o,
});

describe("ConfirmFieldRow", () => {
  it("the ✓ Confirm button accepts the field", () => {
    const onAccept = vi.fn();
    const q = within(render(
      <ConfirmFieldRow field={field()} onAccept={onAccept} onEdit={vi.fn()} onMarkMissing={vi.fn()} />,
    ).container);
    fireEvent.click(q.getByRole("button", { name: /confirm/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("typing in the value input reports an edit", () => {
    const onEdit = vi.fn();
    const q = within(render(
      <ConfirmFieldRow field={field()} onAccept={vi.fn()} onEdit={onEdit} onMarkMissing={vi.fn()} />,
    ).container);
    fireEvent.change(q.getByLabelText(/Brand name/i), { target: { value: "New Brand" } });
    expect(onEdit).toHaveBeenCalledWith("New Brand");
  });

  it("a missing mandatory field offers a 'Not on the label' action", () => {
    const onMarkMissing = vi.fn();
    const q = within(render(
      <ConfirmFieldRow field={field({ aiValue: "", value: "", confidence: undefined, reason: "Not read." })}
        onAccept={vi.fn()} onEdit={vi.fn()} onMarkMissing={onMarkMissing} />,
    ).container);
    fireEvent.click(q.getByRole("button", { name: /not on the label/i }));
    expect(onMarkMissing).toHaveBeenCalledTimes(1);
  });

  it("a non-editable field (warning) renders no input", () => {
    const q = within(render(
      <ConfirmFieldRow field={field({ key: "governmentWarning", label: "Government warning", editable: false, status: "pass", flagged: false, needsConfirmation: false, state: "unconfirmed" })}
        onAccept={vi.fn()} onEdit={vi.fn()} onMarkMissing={vi.fn()} />,
    ).container);
    expect(q.queryByRole("textbox")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/ui/ConfirmFieldRow.test.tsx`
Expected: FAIL ("Cannot find module './ConfirmFieldRow'").

- [ ] **Step 3: Implement `src/app/ui/ConfirmFieldRow.tsx`**

```tsx
import { useId } from "react";
import type { ConfirmFieldResult } from "@/compare";
import { StatusBadge } from "./StatusBadge";
import { TONE_TINT, TONE_ICON, FIELD_LABEL } from "./status";
import { inputClass } from "./fieldStyles";

/**
 * ConfirmFieldRow — one TTB-required element the agent confirms or corrects.
 *
 * The input holds the AI's reading. Pressing Tab on it with no change (or the visible ✓ Confirm
 * button) accepts it ("matches the application"); editing the value re-runs that field's comparator;
 * "Not on the label" marks a mandatory element missing (-> reject). The government warning is not
 * editable (auto-evaluated, statutory) — it renders its status only.
 */
export function ConfirmFieldRow({
  field,
  onAccept,
  onEdit,
  onMarkMissing,
}: {
  field: ConfirmFieldResult;
  onAccept: () => void;
  onEdit: (value: string) => void;
  onMarkMissing: () => void;
}) {
  const inputId = useId();
  const tone = field.status; // pass | review | fail
  const Icon = TONE_ICON[tone];
  const confirmed = field.state !== "unconfirmed";

  return (
    <li className={`rounded-card border-l-4 p-4 shadow-card ${TONE_TINT[tone]}`}>
      <div className="flex flex-wrap items-center gap-2">
        {Icon && <Icon className="h-5 w-5 shrink-0" />}
        <span className="font-semibold">{field.label}</span>
        {field.necessity === "conditional" && (
          <span className="text-xs text-ink-muted" title="Required only in certain cases">(only if it applies)</span>
        )}
        <StatusBadge tone={tone} label={FIELD_LABEL[field.status]} className="ml-auto" />
      </div>

      {field.editable ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={inputId} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {field.label} {typeof field.confidence === "number" && (
                <span className="font-normal normal-case">— AI {Math.round(field.confidence * 100)}% sure</span>
              )}
            </label>
            <input
              id={inputId}
              className={inputClass}
              defaultValue={field.value}
              placeholder="(not read — type it if it's on the label)"
              onChange={(e) => onEdit(e.target.value)}
              onKeyDown={(e) => {
                // Tab accepts the AI reading when the agent hasn't changed it (the "grey field" accelerator).
                if (e.key === "Tab" && !e.shiftKey && field.state === "unconfirmed") onAccept();
              }}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onAccept}
              className="min-h-[44px] rounded-field border-2 border-pass-600 px-3 text-sm font-semibold text-pass-900 hover:bg-pass-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
              {confirmed ? "✓ Confirmed" : "✓ Confirm"}
            </button>
            <button type="button" onClick={onMarkMissing}
              className="min-h-[44px] rounded-field border-2 border-border-strong px-3 text-sm font-semibold text-ink hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
              Not on the label
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 break-words text-sm">{field.reason}</p>
      )}
      {field.editable && <p className="mt-2 break-words text-sm">{field.reason}</p>}
    </li>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/ui/ConfirmFieldRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/ConfirmFieldRow.tsx src/app/ui/ConfirmFieldRow.test.tsx
git commit -m "feat(ui): ConfirmFieldRow — confirm/correct one required element"
```

---

### Task 5: `ConfirmPanel` — hoist flagged fields, drive the gate

**Files:**
- Create: `src/app/ui/ConfirmPanel.tsx`
- Test: `src/app/ui/ConfirmPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/ui/ConfirmPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ConfirmPanel } from "./ConfirmPanel";
import { confirmVerdict, type FieldConfirmation } from "@/compare";
import { CANONICAL_GOVERNMENT_WARNING, type ExtractedFields, type RequirementKey } from "@/domain";

afterEach(cleanup);

function spirits(o: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brand: "Old Tom Distillery", classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)", netContents: "750 mL",
    name: "Old Tom Distillery", address: "Louisville, KY",
    warningText: CANONICAL_GOVERNMENT_WARNING, warningPrefixIsAllCaps: true, warningPrefixIsBold: true,
    confidence: { brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96, name: 0.95, address: 0.95, warningText: 0.96 },
    ...o,
  };
}

/** Renders ConfirmPanel as a controlled component over a confirmations map held by the test harness. */
function Harness({ extracted }: { extracted: ExtractedFields }) {
  const [confirmations, setConfirmations] = (globalThis as unknown as { React: typeof import("react") }).React.useState<Partial<Record<RequirementKey, FieldConfirmation>>>({});
  const verdict = confirmVerdict(extracted, confirmations);
  const set = (key: RequirementKey, c: FieldConfirmation) => setConfirmations((p) => ({ ...p, [key]: c }));
  return (
    <ConfirmPanel
      verdict={verdict}
      onAccept={(k) => set(k, { state: "accepted" })}
      onEdit={(k, v) => set(k, { state: "edited", editedValue: v })}
      onMarkMissing={(k) => set(k, { state: "missing" })}
    />
  );
}

describe("ConfirmPanel", () => {
  it("hoists a flagged (low-confidence) field into a 'Needs your check' group", () => {
    const e = spirits({ confidence: { ...spirits().confidence, brand: 0.4 } });
    const q = within(render(<ConfirmPanel verdict={confirmVerdict(e, {})} onAccept={vi.fn()} onEdit={vi.fn()} onMarkMissing={vi.fn()} />).container);
    expect(q.getByText(/needs your check/i)).toBeTruthy();
  });

  it("shows a confirm prompt while awaiting and the approve verdict once nothing needs a check", () => {
    const clean = confirmVerdict(spirits(), {});
    const q = within(render(<ConfirmPanel verdict={clean} onAccept={vi.fn()} onEdit={vi.fn()} onMarkMissing={vi.fn()} />).container);
    // Clean high-confidence label: nothing to confirm, verdict is Approve.
    expect(q.getByText("Approve")).toBeTruthy();
  });
});
```

> Note: the harness's `globalThis.React` shim is only to keep the test terse; in the real test file import `useState` from "react" directly (`import { useState } from "react"`). Use that form when writing the file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/ui/ConfirmPanel.test.tsx`
Expected: FAIL ("Cannot find module './ConfirmPanel'").

- [ ] **Step 3: Implement `src/app/ui/ConfirmPanel.tsx`**

```tsx
import type { Ref } from "react";
import type { ConfirmVerdict } from "@/compare";
import type { RequirementKey } from "@/domain";
import { ConfirmFieldRow } from "./ConfirmFieldRow";
import { TONE_TINT, TONE_ICON, VERDICT_LABEL, toneForStatus } from "./status";
import { CLASS_DISPLAY_LABEL } from "./beverageClass";

const NEXT_STEP: Record<ConfirmVerdict["overall"], string> = {
  approve: "Every required field is confirmed and matches — this label can be approved.",
  review: "Some fields need a person's eyes — confirm or correct the highlighted ones below.",
  reject: "A required check failed — review the items marked “No match” before sending this back.",
};

/**
 * ConfirmPanel — the confirm-to-approve hybrid. The AI has pre-filled every field TTB requires for
 * the resolved beverage type; the agent confirms (Tab/✓) or corrects each. Flagged fields are hoisted
 * into a "Needs your check" group and block the verdict from resolving to Approve until handled; the
 * rest sit in a compact, pre-confirmed group. Verify-first: the headline outcome leads.
 */
export function ConfirmPanel({
  verdict,
  onAccept,
  onEdit,
  onMarkMissing,
  headingRef,
}: {
  verdict: ConfirmVerdict;
  onAccept: (key: RequirementKey) => void;
  onEdit: (key: RequirementKey, value: string) => void;
  onMarkMissing: (key: RequirementKey) => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const flagged = verdict.fields.filter((f) => f.needsConfirmation);
  const settled = verdict.fields.filter((f) => !f.needsConfirmation);
  const tone = verdict.awaitingConfirmation ? "review" : toneForStatus(verdict.overall);
  const OverallIcon = TONE_ICON[tone];

  return (
    <section aria-label="Confirm the label against the application" className="mt-6 flex flex-col gap-4">
      <h2 ref={headingRef} tabIndex={-1}
        className="text-lg font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
        Confirm the required fields
      </h2>

      <div className={`flex items-start gap-4 rounded-card border-l-8 p-5 shadow-card ${TONE_TINT[tone]}`}>
        {OverallIcon && <OverallIcon className="h-9 w-9 shrink-0" />}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
            {CLASS_DISPLAY_LABEL[verdict.beverageClass]}
          </p>
          <p className="text-2xl font-bold">
            {verdict.awaitingConfirmation
              ? `${flagged.length} field${flagged.length === 1 ? "" : "s"} need your check`
              : VERDICT_LABEL[verdict.overall]}
          </p>
          <p className="mt-1 text-sm">
            {verdict.awaitingConfirmation
              ? "The AI filled in what it read. Confirm or correct each highlighted field below to finish."
              : NEXT_STEP[verdict.overall]}
          </p>
        </div>
      </div>

      {flagged.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">Needs your check</h3>
          <ul className="flex flex-col gap-3">
            {flagged.map((f) => (
              <ConfirmFieldRow key={f.key} field={f}
                onAccept={() => onAccept(f.key)} onEdit={(v) => onEdit(f.key, v)} onMarkMissing={() => onMarkMissing(f.key)} />
            ))}
          </ul>
        </div>
      )}

      {settled.length > 0 && (
        <details className="rounded-card border border-border bg-surface-muted p-4" open={flagged.length === 0}>
          <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-ink">
            {flagged.length === 0 ? "All fields" : `Confirmed fields (${settled.length})`} — tap to review
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {settled.map((f) => (
              <ConfirmFieldRow key={f.key} field={f}
                onAccept={() => onAccept(f.key)} onEdit={(v) => onEdit(f.key, v)} onMarkMissing={() => onMarkMissing(f.key)} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/ui/ConfirmPanel.test.tsx`
Expected: PASS. (Write the test's `Harness` using a real `import { useState } from "react"`.)

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/ConfirmPanel.tsx src/app/ui/ConfirmPanel.test.tsx
git commit -m "feat(ui): ConfirmPanel — hoist flagged fields, gate the verdict"
```

---

### Task 6: Refactor `VerifyForm` to drive the confirm panel

**Files:**
- Modify: `src/app/VerifyForm.tsx`
- Modify: `src/app/VerifyForm.test.tsx`

- [ ] **Step 1: Replace the claimed-form state + verdict derivation**

In `src/app/VerifyForm.tsx`:

Remove the `claimed` state, the `combined` useMemo, the `verdict`/`canVerify`/`onVerifyClick` block, and the `justVerified` ref. Replace the imports of `combinedVerdict`/`CombinedVerdict`/`ResultView` with the confirm model + panel:

```ts
import { confirmVerdict, type ConfirmVerdict, type FieldConfirmation } from "@/compare";
import type { RequirementKey } from "@/domain";
import { ConfirmPanel } from "./ui/ConfirmPanel";
```

Add confirmations state (reset whenever a new readable response arrives):

```ts
  const [confirmations, setConfirmations] = useState<Partial<Record<RequirementKey, FieldConfirmation>>>({});

  const verdict: ConfirmVerdict | null = useMemo(
    () => (state === "done" && response?.readable ? confirmVerdict(response.extracted, confirmations) : null),
    [state, response, confirmations],
  );
```

In `read()`, on a successful readable response, reset confirmations so a new label starts fresh:

```ts
      setResponse(json as VerifyApiResponse);
      setConfirmations({});
      setState("done");
```

Confirmation handlers:

```ts
  const accept = (key: RequirementKey) => setConfirmations((p) => ({ ...p, [key]: { state: "accepted" } }));
  const edit = (key: RequirementKey, value: string) => setConfirmations((p) => ({ ...p, [key]: { state: "edited", editedValue: value } }));
  const markMissing = (key: RequirementKey) => setConfirmations((p) => ({ ...p, [key]: { state: "missing" } }));
```

- [ ] **Step 2: Replace the application `<form>` and the results block**

Delete the entire `{/* Step 2 — the application values… */}` `<form>…</form>` block. The confirm panel replaces it; it appears under the results once a read settles. Update the intro copy (remove "Add the application values"):

```tsx
      <p class
Name="mt-1 text-ink-muted">
        Upload the product&apos;s front label (and the back, if you have it) and the AI reads them
        together, fills in every field TTB requires for the beverage type, and asks you to confirm or
        correct each. No typing required to read.
      </p>
```
*(fix the deliberate `class\nName` line break — write `className` — included only to flag the exact attribute to edit.)*

Replace the live region + results section. The live region announces the confirm verdict:

```tsx
      <p role="status" aria-live="polite" className="sr-only">
        {verdict
          ? verdict.awaitingConfirmation
            ? `${verdict.fields.filter((f) => f.needsConfirmation).length} fields need your confirmation.`
            : `Verdict: ${verdict.overall === "approve" ? "Approve" : verdict.overall === "reject" ? "Reject" : "Needs review"}.`
          : ""}
      </p>
```

Results block (lead with the confirm panel, then completeness, then extraction):

```tsx
      {readable && response && (
        <>
          {verdict && (
            <ConfirmPanel
              verdict={verdict}
              onAccept={accept}
              onEdit={edit}
              onMarkMissing={markMissing}
              headingRef={verdictHeadingRef}
            />
          )}
          {response.completeness && (
            <CompletenessView completeness={response.completeness} headingRef={completenessHeadingRef} />
          )}
          <ExtractedFieldsView extracted={response.extracted} headingRef={resultHeadingRef} />
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={onDownloadJson} className={secondaryButtonClass}>Download JSON</button>
            <button type="button" onClick={onDownloadCsv} className={secondaryButtonClass}>Download CSV</button>
            <button type="button" onClick={() => void read(orderedImages)} className={secondaryButtonClass}>Read again</button>
          </div>
        </>
      )}
```

Keep the focus effect (it already targets `verdictHeadingRef.current || completenessHeadingRef.current || resultHeadingRef.current`).

- [ ] **Step 3: Update the JSON/CSV export to carry the confirmed verdict + values**

Replace `onDownloadJson`/`onDownloadCsv` bodies:

```ts
  function onDownloadJson() {
    if (!response) return;
    downloadJson(`${exportBase}.json`, {
      images: orderedImages.map((i) => ({ filename: i.file.name, position: i.position })),
      provider: response.provider,
      extracted: response.extracted,
      completeness: response.completeness,
      ...(verdict ? { confirm: { overall: verdict.overall, awaitingConfirmation: verdict.awaitingConfirmation, fields: verdict.fields.map((f) => ({ key: f.key, value: f.value, status: f.status, state: f.state })) } } : {}),
    });
  }
  function onDownloadCsv() {
    if (!response) return;
    downloadCsv(`${exportBase}.csv`, analysisToCsv([
      { filename: exportBase, extracted: response.extracted, completeness: response.completeness, overall: verdict?.overall ?? undefined },
    ]));
  }
```

> The single-screen CSV's `result` per-field columns came from the old `VerifyResult`; the confirm flow no longer produces a 3-field `VerifyResult`. Drop the `result` arg to `analysisToCsv` here (it is optional in `csv.ts`); the `overall` column now reflects the confirm verdict. Verify `analysisToCsv`'s row type tolerates an omitted `result` — it does (the batch JSON path already omits it). If `csv.ts` requires `result`, make it optional in that file as a one-line change and note it.

- [ ] **Step 4: Update the component tests**

Rewrite `src/app/VerifyForm.test.tsx`'s claimed-form tests to the confirm flow. Replace the "claimed-vs-application verification" describe block with:

```tsx
describe("VerifyForm — confirm-to-approve", () => {
  it("a clean high-confidence label resolves to Approve with nothing to confirm", ASYNC, async () => {
    mockFetch({ provider: "mock", readable: true, extracted: extractedBourbon(), result: null });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    expect(await q.findByText("Confirm the required fields")).toBeTruthy();
    expect(q.getByText("Approve")).toBeTruthy();
  });

  it("a low-confidence field is hoisted and blocks Approve until confirmed", ASYNC, async () => {
    mockFetch({
      provider: "mock", readable: true,
      extracted: extractedBourbon({ confidence: { ...extractedBourbon().confidence, brand: 0.4 } }),
      result: null,
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Confirm the required fields");
    expect(q.getByText(/need your check/i)).toBeTruthy();
    // Confirm the flagged brand -> verdict resolves to Approve.
    fireEvent.click(q.getAllByRole("button", { name: /confirm/i })[0]);
    expect(await q.findByText("Approve")).toBeTruthy();
  });

  it("marking a missing mandatory field 'Not on the label' rejects", ASYNC, async () => {
    mockFetch({
      provider: "mock", readable: true,
      extracted: extractedBourbon({ netContents: undefined }),
      result: null,
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Confirm the required fields");
    fireEvent.click(q.getByRole("button", { name: /not on the label/i }));
    expect(await q.findByText("Reject")).toBeTruthy();
  });
});
```

Keep the existing "unreadable image" and "shows two upload slots" tests. Delete tests that reference the removed Brand/Alcohol application inputs and the "Verify against the application" button.

- [ ] **Step 5: Run the component tests + typecheck**

Run: `npx vitest run src/app/VerifyForm.test.tsx` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/VerifyForm.tsx src/app/VerifyForm.test.tsx
git commit -m "feat(ui): VerifyForm drives the confirm-to-approve panel (replaces the application form)"
```

---

### Task 7: Retire / adapt `ResultView` and the dead `combinedVerdict` single-screen path

**Files:**
- Modify: `src/app/ResultView.tsx` (and its test) — OR delete if unused.

- [ ] **Step 1: Check for remaining references**

Run: `npx grep -rn "ResultView" src/app` (or the Grep tool).
- If `VerifyForm` no longer imports `ResultView`, and nothing else does, **delete** `src/app/ResultView.tsx` and `src/app/ResultView.test.tsx`.
- The batch screen does NOT use `ResultView` (it renders its own table), so deletion is safe if the single screen dropped it.

- [ ] **Step 2: Confirm `combinedVerdict` still has a home**

`combinedVerdict` remains used by the batch screen and the eval harness — do NOT remove it. Only the single screen migrated to `confirmVerdict`. Verify: `npx grep -rn "combinedVerdict" src eval` shows batch + eval still use it.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS. Fix any dangling import.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(ui): remove the single-screen ResultView superseded by ConfirmPanel"
```

---

### Task 8: Full gate + eval + manual smoke

**Files:** none (verification).

- [ ] **Step 1: Run the whole feedback loop**

Run: `npm run typecheck && npm run lint && npm test && npm run eval && npm run build`
Expected: all green; eval approve-precision ≥ 0.98 (the eval still drives the API path via `combinedVerdict`, which is unchanged — the confirm flow is UI-only, so eval is unaffected). Confirm the test count rose (new confirm tests).

- [ ] **Step 2: Manual smoke (mock provider)**

Start the dev server in mock mode; upload a fixture-named image (e.g. `old-tom-bourbon-clean.svg`); verify: the confirm panel lists the spirits required fields, high-confidence ones are pre-confirmed, the verdict reads Approve, and a low-confidence/missing fixture hoists a field and blocks Approve until confirmed/corrected.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "test(ui): confirm-to-approve flow green across typecheck/lint/test/eval/build"
```

---

## Self-Review

**Spec coverage (§2–3, AC-1, AC-A1–A4):**
- §2 per-field confidence-aware verdict model → Task 2 (`confirmVerdict`). ✓ (with the two documented refinements)
- §2 reuse `compareBrand`/`compareAlcohol`/`compareWarning` + per-field equality → Task 2 `statusForEdit` + reused warning classifier. ✓
- §2 warning is auto-evaluated, not free-text → Task 2 warning branch (`editable:false`) + Task 4 (no input when `!editable`). ✓ (AC-A3)
- §2 reject-on-confirmed-missing → Task 2 `state:"missing"` → `fail`. ✓
- §2 conditional never blocks → Task 2 conditional-absent → pass/neutral; test in Task 2. ✓ (AC-2)
- §3 flagged hoisted + required, high-confidence pre-confirmed → Task 5 `ConfirmPanel`. ✓ (AC-A1)
- §3 ✓ button AND Tab accept; edit re-runs comparator → Task 4 + Task 6 reactive `useMemo`. ✓ (AC-A2)
- §3 dynamic by type → Task 2 drives off `mandatoryElementsFor(beverageClass)`. ✓
- §3 verify-first (headline leads) → Task 5 banner first; Task 6 panel before completeness/extraction. ✓
- AC-A4 accessibility (focus, ≥44px, icon+text+color, announced) → Task 4 (≥44px buttons, labelled input), Task 6 (live region + focus-to-heading), shared tone (icon+text+color). ✓
- AC-1 reject clause → now MET via the confirm flow (Task 2 missing→fail). ✓

**Placeholder scan:** Task 6 Step 2 contains a deliberately-flagged `class\nName` typo marker — the executor must write `className`. No other TBD/placeholder; all code blocks are complete. The `Harness` shim note in Task 5 Step 1 must be written with a real `useState` import.

**Type consistency:** `ConfirmState`, `FieldConfirmation`, `ConfirmFieldResult`, `ConfirmVerdict`, `confirmVerdict(extracted, confirmations)` are used identically in Tasks 2–6. `onAccept(key)`, `onEdit(key,value)`, `onMarkMissing(key)` signatures match between `ConfirmPanel` (Task 5) and `VerifyForm` (Task 6); `ConfirmFieldRow` (Task 4) takes the no-arg variants bound per row. `FIELD_LABEL`/`TONE_*`/`VERDICT_LABEL` already exist in `status.tsx` (added in the quick-wins pass).

**Out of scope (Feature B):** decision recording, persistence, the worklist, the explicit "Approve" button that stores a humanDecision. Part 2 stops at the gated reactive verdict.
