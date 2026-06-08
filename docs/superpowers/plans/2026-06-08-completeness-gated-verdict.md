# Completeness-Gated Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Approve/Needs-review/Reject verdict require every field TTB mandates for the beverage type — even when brand/alcohol/warning all pass, an incomplete label can no longer be Approved.

**Architecture:** A single new pure function, `combinedVerdict(claimed, extracted)`, composes the existing `verifyLabel` (claimed-vs-label, 3 checks) with the existing `checkCompleteness` (per-type required-element check) and returns the **worse** of the two as the headline verdict. Nothing in the CFR domain changes. This first plan maps a missing/malformed **mandatory** element to `review` (blocks approval without auto-rejecting on a possible misread); the government warning keeps its hard-fail via `verifyLabel`. A later plan (confirm-to-approve UX) adds the human confirmation that escalates a confirmed-missing element to `reject`.

**Tech Stack:** TypeScript (strict), Vitest, Next.js App Router, React 19. All pure logic; offline mock provider; `typecheck · lint · test · eval · build` stay green.

---

## File structure

- **Create** `src/compare/reviewVerdict.ts` — the pure `combinedVerdict` + `worstVerdict` + `CombinedVerdict` type. One responsibility: combine comparison + completeness into one verdict.
- **Create** `src/compare/reviewVerdict.test.ts` — unit tests for the combiner.
- **Modify** `src/compare/index.ts` — re-export the new function/types.
- **Modify** `eval/evaluate.ts` — compute `actualOverall` from `combinedVerdict` (the production headline) instead of `verifyLabel` alone.
- **Modify** `eval/fixtures/cases.json` + add `eval/fixtures/images/old-tom-no-net-contents.svg` + rows in `eval/fixtures/README.md` and `eval/fixtures/images/MANIFEST.md` — a fixture proving the new gating (3 checks pass, a mandatory field missing → review).
- **Modify** `src/app/ResultView.tsx` — show the combined overall + a plain note when completeness gated an otherwise-passing label.
- **Modify** `src/app/VerifyForm.tsx` — the verdict `useMemo` uses `combinedVerdict`; pass the combined overall + flag to `ResultView`; exports use the combined verdict.
- **Modify** `src/app/batch/BatchVerify.tsx` — per-product verdict uses `combinedVerdict`; the batch badge shows the combined overall.
- **Modify** `src/batch/csv.ts` — `AnalysisRow` carries an optional combined `overall` for the export column.
- **Modify** `src/app/batch/BatchVerify.test.tsx` — the mock response gains `name`/`address` so a complete label still Approves.
- **Modify** `CLAUDE.md` + `AGENTS.md` — one line each noting the verdict now gates on per-type completeness.

---

## Task 1: The `combinedVerdict` pure function

**Files:**
- Create: `src/compare/reviewVerdict.ts`
- Test: `src/compare/reviewVerdict.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/compare/reviewVerdict.test.ts
/**
 * reviewVerdict.test.ts — the verdict that gates approval on per-type completeness.
 */
import { describe, it, expect } from "vitest";
import { combinedVerdict, worstVerdict } from "./reviewVerdict";
import { CANONICAL_GOVERNMENT_WARNING, type ClaimedFields, type ExtractedFields } from "@/domain";

const CLAIMED: ClaimedFields = {
  brand: "Old Tom Distillery",
  classType: "distilled-spirits",
  alcoholContentText: "45% Alc./Vol. (90 Proof)",
};

/** A distilled-spirits label that carries EVERY mandatory element (brand, class/type, alcohol, net
 *  contents, producer name + address, government warning). */
function completeSpirits(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
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

describe("worstVerdict", () => {
  it("returns the more conservative of two verdicts", () => {
    expect(worstVerdict("approve", "review")).toBe("review");
    expect(worstVerdict("reject", "review")).toBe("reject");
    expect(worstVerdict("approve", "approve")).toBe("approve");
  });
});

describe("combinedVerdict", () => {
  it("APPROVE: every mandatory element present and the 3 checks pass", () => {
    const r = combinedVerdict(CLAIMED, completeSpirits());
    expect(r.overall).toBe("approve");
    expect(r.gatedByCompleteness).toBe(false);
    expect(r.verify?.overall).toBe("approve");
  });

  it("GATES approve -> review when the 3 checks pass but a MANDATORY field is missing", () => {
    // Drop net contents (mandatory for spirits). Brand/alcohol/warning still pass.
    const r = combinedVerdict(CLAIMED, completeSpirits({ netContents: undefined, confidence: {
      brand: 0.98, classType: 0.97, alcoholContent: 0.98, name: 0.95, address: 0.95, warningText: 0.96,
    } }));
    expect(r.verify?.overall).toBe("approve"); // the 3 checks alone would approve
    expect(r.overall).toBe("review");          // but completeness blocks it
    expect(r.gatedByCompleteness).toBe(true);
  });

  it("REJECT dominates: an out-of-tolerance ABV rejects regardless of completeness", () => {
    const r = combinedVerdict(
      { ...CLAIMED, alcoholContentText: "45% Alc./Vol." },
      completeSpirits({ alcoholContentText: "46% Alc./Vol.", netContents: undefined }),
    );
    expect(r.overall).toBe("reject");
    expect(r.gatedByCompleteness).toBe(false); // verify already reject; completeness didn't worsen it
  });

  it("no application values -> overall null (completeness is the headline)", () => {
    const r = combinedVerdict(null, completeSpirits());
    expect(r.overall).toBeNull();
    expect(r.verify).toBeNull();
    expect(r.completeness.overall).toBe("complete");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/compare/reviewVerdict.test.ts`
Expected: FAIL — `combinedVerdict`/`worstVerdict` not found (module doesn't exist).

- [ ] **Step 3: Write the implementation**

```ts
// src/compare/reviewVerdict.ts
/**
 * compare/reviewVerdict.ts — combine the claimed-vs-label comparison with the per-type TTB
 * completeness check into ONE headline verdict. This realizes "you can't approve a label that is
 * missing a field TTB requires for its beverage type": even when brand / alcohol / government
 * warning all pass, an incomplete label is no longer Approved.
 *
 * Pure and deterministic (no I/O, no model). A missing/malformed MANDATORY element maps to `review`
 * — it blocks approval, but does not auto-reject, because the extractor may have misread a present
 * field (asymmetric: never auto-approve an incomplete label, never auto-reject on a possible miss).
 * The government warning keeps its hard-fail-on-missing via verifyLabel's strict check. A later plan
 * adds the human confirm-to-approve step that escalates a confirmed-missing element to `reject`.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import { verifyLabel, type VerifyResult, type OverallVerdict } from "./verify";
import { checkCompleteness, type CompletenessResult, type CompletenessOverall } from "./completeness";

const RANK: Record<OverallVerdict, number> = { approve: 0, review: 1, reject: 2 };

/** The worse (more conservative) of two verdicts. */
export function worstVerdict(a: OverallVerdict, b: OverallVerdict): OverallVerdict {
  return RANK[a] >= RANK[b] ? a : b;
}

/** How a completeness outcome constrains the overall verdict. `incomplete` (a missing/malformed
 *  mandatory element) blocks approval -> `review`; the confirm-to-approve plan later escalates a
 *  human-confirmed missing element to `reject`. */
const COMPLETENESS_VERDICT: Record<CompletenessOverall, OverallVerdict> = {
  complete: "approve",
  review: "review",
  incomplete: "review",
};

export interface CombinedVerdict {
  /** Headline verdict, or null when no application values were supplied (completeness is the headline). */
  overall: OverallVerdict | null;
  /** The claimed-vs-label comparison (null when no application values supplied). */
  verify: VerifyResult | null;
  /** The per-type completeness check. */
  completeness: CompletenessResult;
  /** True when the 3 checks alone would have been more lenient but completeness made the verdict worse. */
  gatedByCompleteness: boolean;
}

/**
 * Combine the comparison + completeness into one verdict.
 * @param claimed application values, or null when none supplied (then `overall` is null and the
 *               completeness summary is the headline, matching today's no-application behavior).
 * @param extracted the merged label reading.
 */
export function combinedVerdict(
  claimed: ClaimedFields | null,
  extracted: ExtractedFields,
): CombinedVerdict {
  const completeness = checkCompleteness(extracted);
  const completenessVerdict = COMPLETENESS_VERDICT[completeness.overall];

  const hasClaimed =
    claimed != null &&
    (claimed.brand ?? "").trim() !== "" &&
    (claimed.alcoholContentText ?? "").trim() !== "";
  if (!hasClaimed) {
    return { overall: null, verify: null, completeness, gatedByCompleteness: false };
  }

  const verify = verifyLabel(claimed, extracted);
  const overall = worstVerdict(verify.overall, completenessVerdict);
  return { overall, verify, completeness, gatedByCompleteness: overall !== verify.overall };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/compare/reviewVerdict.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/compare/reviewVerdict.ts src/compare/reviewVerdict.test.ts
git commit -m "feat(compare): combinedVerdict — gate approval on per-type completeness"
```

---

## Task 2: Export from the compare barrel

**Files:**
- Modify: `src/compare/index.ts`

- [ ] **Step 1: Add the re-export**

Open `src/compare/index.ts` and add (next to the other `verify`/`completeness` exports):

```ts
export { combinedVerdict, worstVerdict, type CombinedVerdict } from "./reviewVerdict";
```

- [ ] **Step 2: Verify the barrel typechecks**

Run: `npm run typecheck`
Expected: PASS (no output / exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/compare/index.ts
git commit -m "feat(compare): export combinedVerdict from the barrel"
```

---

## Task 3: Migrate the eval harness + add a gating fixture

The eval must measure the **production** headline verdict (now `combinedVerdict`), and a fixture must prove the new behavior: a label whose 3 checks all pass but which is missing a mandatory field resolves to `review`, not `approve`.

**Files:**
- Modify: `eval/evaluate.ts:108-121` (the actual-verdict block)
- Modify: `eval/fixtures/cases.json` (add one case)
- Create: `eval/fixtures/images/old-tom-no-net-contents.svg`
- Modify: `eval/fixtures/README.md` (table row + rationale)
- Modify: `eval/fixtures/images/MANIFEST.md` (table row)

- [ ] **Step 1: Add the gating fixture to `cases.json`**

Insert this case object into the `cases` array in `eval/fixtures/cases.json` (after the last case, before the closing `]`; add a comma after the previous case's closing `}`):

```json
    {
      "id": "missing-net-contents-review",
      "imageFilename": "old-tom-no-net-contents.svg",
      "claimed": {
        "brand": "OLD TOM DISTILLERY",
        "classType": "distilled-spirits",
        "beverageClass": "Distilled spirits",
        "alcoholContent": "45% Alc./Vol. (90 Proof)",
        "netContents": "750 mL"
      },
      "extracted": {
        "brand": { "value": "OLD TOM DISTILLERY", "confidence": 0.98 },
        "classType": { "value": "Kentucky Straight Bourbon Whiskey", "confidence": 0.97 },
        "alcoholContent": { "value": "45% Alc./Vol. (90 Proof)", "confidence": 0.98 },
        "name": { "value": "Old Tom Distillery", "confidence": 0.95 },
        "address": { "value": "Louisville, KY", "confidence": 0.93 },
        "warningText": {
          "value": "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
          "confidence": 0.97
        },
        "warningPrefixIsAllCaps": true,
        "warningPrefixIsBold": true
      },
      "expected": {
        "perField": { "brand": "pass", "alcohol": "pass", "warning": "pass" },
        "overall": "review"
      },
      "notes": "COMPLETENESS GATE case. Brand, alcohol, and the government warning all pass the three claimed-vs-label checks — under the old 3-check model this approved. But net contents is a MANDATORY element for distilled spirits (27 CFR Part 5) and is absent from the read, so the per-type completeness check is incomplete. combinedVerdict takes the worse of {3-check approve, completeness review} -> overall REVIEW. Proves a label can no longer be approved while missing a TTB-required field, without auto-rejecting on a possible misread."
    }
```

- [ ] **Step 2: Add the placeholder image**

Create `eval/fixtures/images/old-tom-no-net-contents.svg`:

```html
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800" font-family="Georgia, 'Times New Roman', serif">
  <rect width="600" height="800" fill="#f6efe2" stroke="#8a6d3b" stroke-width="6"/>
  <rect x="14" y="14" width="572" height="772" fill="none" stroke="#8a6d3b" stroke-width="1.5"/>
  <rect x="0" y="0" width="600" height="34" fill="#f9a825"/>
  <text x="300" y="23" text-anchor="middle" fill="#000" font-size="15" font-weight="bold" letter-spacing="1">PLACEHOLDER — completeness gate — NET CONTENTS MISSING</text>
  <text x="300" y="150" text-anchor="middle" fill="#3a2c12" font-size="46" font-weight="bold" letter-spacing="3">OLD TOM</text>
  <text x="300" y="200" text-anchor="middle" fill="#3a2c12" font-size="40" font-weight="bold" letter-spacing="6">DISTILLERY</text>
  <text x="300" y="270" text-anchor="middle" fill="#5a4423" font-size="22" font-style="italic">Kentucky Straight Bourbon Whiskey</text>
  <text x="300" y="330" text-anchor="middle" fill="#3a2c12" font-size="24" font-weight="bold">45% Alc./Vol. (90 Proof)</text>
  <text x="300" y="370" text-anchor="middle" fill="#b03a2e" font-size="16" font-style="italic">(net contents intentionally omitted)</text>
  <text x="60" y="470" fill="#1a1a1a" font-size="15" font-family="Arial, Helvetica, sans-serif"><tspan font-weight="bold">GOVERNMENT WARNING:</tspan><tspan font-weight="normal"> (1) According to the</tspan></text>
  <text x="60" y="494" fill="#1a1a1a" font-size="15" font-family="Arial, Helvetica, sans-serif">Surgeon General, women should not drink alcoholic</text>
  <text x="60" y="518" fill="#1a1a1a" font-size="15" font-family="Arial, Helvetica, sans-serif">beverages during pregnancy because of the risk of</text>
  <text x="60" y="542" fill="#1a1a1a" font-size="15" font-family="Arial, Helvetica, sans-serif">birth defects. (2) Consumption of alcoholic beverages</text>
  <text x="60" y="566" fill="#1a1a1a" font-size="15" font-family="Arial, Helvetica, sans-serif">impairs your ability to drive a car or operate machinery,</text>
  <text x="60" y="590" fill="#1a1a1a" font-size="15" font-family="Arial, Helvetica, sans-serif">and may cause health problems.</text>
  <text x="300" y="745" text-anchor="middle" fill="#8a6d3b" font-size="12">imageFilename: old-tom-no-net-contents.svg</text>
</svg>
```

- [ ] **Step 3: Migrate `evaluate.ts` to the combined verdict**

In `eval/evaluate.ts`, add the import near the top imports:

```ts
import { combinedVerdict } from "@/compare";
```

Replace the actual-verdict block (currently around lines 108-121):

```ts
    let actualOverall: OverallVerdict;
    let actualFields: Record<FieldKey, FieldStatus>;
    if (!outcome.readable || !outcome.result) {
      // Unreadable -> re-upload. Counts as "review" (a human must look), never "approve".
      actualOverall = "review";
      actualFields = { brand: "review", alcohol: "review", warning: "review" };
    } else {
      actualOverall = outcome.result.overall;
      actualFields = {
        brand: outcome.result.brand.status,
        alcohol: outcome.result.alcohol.status,
        warning: outcome.result.warning.status,
      };
    }
```

with:

```ts
    let actualOverall: OverallVerdict;
    let actualFields: Record<FieldKey, FieldStatus>;
    if (!outcome.readable || !outcome.result) {
      // Unreadable -> re-upload. Counts as "review" (a human must look), never "approve".
      actualOverall = "review";
      actualFields = { brand: "review", alcohol: "review", warning: "review" };
    } else {
      // The PRODUCTION headline verdict gates the 3-check result on per-type completeness.
      const combined = combinedVerdict(claimed, outcome.extracted);
      actualOverall = combined.overall ?? "review";
      actualFields = {
        brand: outcome.result.brand.status,
        alcohol: outcome.result.alcohol.status,
        warning: outcome.result.warning.status,
      };
    }
```

- [ ] **Step 4: Run the eval test and the eval gate**

Run: `npx vitest run eval/evaluate.test.ts`
Expected: PASS — every fixture's overall matches its label (the new `missing-net-contents-review` case resolves to `review`; the approve fixtures still approve because they carry name + address; the reject/review fixtures are unchanged).

Run: `npm run eval`
Expected: prints the table; `APPROVE precision: 100.0% (floor 98.0%) -> PASS`.

- [ ] **Step 5: Update the fixtures docs**

In `eval/fixtures/README.md`, add a row to the cases table (after the `malt-beverage-approve` row):

```markdown
| `missing-net-contents-review` | `old-tom-no-net-contents.svg` | pass | pass | pass | **review** |
```

and a rationale bullet (after the malt bullet):

```markdown
- **Missing mandatory field -> review (completeness gate)** — brand/alcohol/warning all pass, but net
  contents (mandatory for spirits) is absent, so `combinedVerdict` takes the worse of {approve,
  completeness-review} -> **review**. Proves a label can't be approved while missing a TTB-required
  field, without auto-rejecting a possible misread.
```

In `eval/fixtures/images/MANIFEST.md`, add a table row (#15):

```markdown
| 15 | `old-tom-no-net-contents.svg` | `eval/fixtures/images/old-tom-no-net-contents.svg` | `missing-net-contents-review` | Portrait label, ~600x800 | Identical to #1 EXCEPT **net contents is omitted**. Brand/class/alcohol/warning all correct; the missing mandatory field is the sole defect. | **review** |
```

- [ ] **Step 6: Commit**

```bash
git add eval/evaluate.ts eval/fixtures/cases.json eval/fixtures/images/old-tom-no-net-contents.svg eval/fixtures/README.md eval/fixtures/images/MANIFEST.md
git commit -m "test(eval): measure the completeness-gated verdict + add a missing-field fixture"
```

---

## Task 4: Show the gated verdict on the single screen

`ResultView` must display the **combined** overall (which may be worse than the 3 cards suggest) and explain when completeness gated an otherwise-passing label. `VerifyForm` switches its verdict `useMemo` to `combinedVerdict`.

**Files:**
- Modify: `src/app/ResultView.tsx`
- Modify: `src/app/VerifyForm.tsx`
- Test: `src/app/VerifyForm.test.tsx` (add one case)

- [ ] **Step 1: Update `ResultView` props + gating note**

In `src/app/ResultView.tsx`: change the import to also pull the verdict type, update the component signature, drive the banner from `overall`, and render a note when gated. Replace the component's prop block and banner:

Change the signature/props from:

```tsx
export function ResultView({
  result,
  headingRef,
}: {
  result: VerifyResult;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const tone = toneForStatus(result.overall);
```

to:

```tsx
export function ResultView({
  result,
  overall,
  gatedByCompleteness = false,
  headingRef,
}: {
  result: VerifyResult;
  /** The headline verdict (the comparison gated on completeness); defaults to the comparison's own. */
  overall?: VerifyResult["overall"];
  /** True when the 3 checks passed/were lenient but a missing required field made the verdict worse. */
  gatedByCompleteness?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const headline = overall ?? result.overall;
  const tone = toneForStatus(headline);
```

Then in the banner JSX, replace `VERDICT_LABEL[result.overall]` and `NEXT_STEP[result.overall]` with `VERDICT_LABEL[headline]` and `NEXT_STEP[headline]`, and add the gating note immediately after the `<p className="mt-1 text-sm">{NEXT_STEP[...]}</p>` line:

```tsx
          <p className="mt-1 text-sm">{NEXT_STEP[headline]}</p>
          {gatedByCompleteness && (
            <p className="mt-1 text-sm font-medium">
              The three checks matched, but the label is missing a field TTB requires for this
              beverage type — see the completeness check below.
            </p>
          )}
```

- [ ] **Step 2: Update `VerifyForm` to compute the combined verdict**

In `src/app/VerifyForm.tsx`:

Change the imports from `@/compare`:

```tsx
import { verifyLabel, type VerifyResult } from "@/compare";
```

to:

```tsx
import { combinedVerdict, type CombinedVerdict, type VerifyResult } from "@/compare";
```

Replace the `verdict` memo:

```tsx
  const verdict: VerifyResult | null = useMemo(() => {
    if (state !== "done" || !response?.readable) return null;
    if (claimed.brand.trim() === "" || claimed.alcohol.trim() === "") return null;
    return verifyLabel(
      {
        brand: claimed.brand.trim(),
        alcoholContentText: claimed.alcohol.trim(),
        classType: claimed.classType.trim() || undefined,
      },
      response.extracted,
    );
  }, [state, response, claimed.brand, claimed.alcohol, claimed.classType]);
```

with:

```tsx
  const combined: CombinedVerdict | null = useMemo(() => {
    if (state !== "done" || !response?.readable) return null;
    if (claimed.brand.trim() === "" || claimed.alcohol.trim() === "") return null;
    return combinedVerdict(
      {
        brand: claimed.brand.trim(),
        alcoholContentText: claimed.alcohol.trim(),
        classType: claimed.classType.trim() || undefined,
      },
      response.extracted,
    );
  }, [state, response, claimed.brand, claimed.alcohol, claimed.classType]);
  // The per-field comparison (for the cards) and the gated headline verdict.
  const verdict: VerifyResult | null = combined?.verify ?? null;
```

Update the `ResultView` render to pass the combined headline + flag:

```tsx
          {verdict && (
            <ResultView
              result={verdict}
              overall={combined?.overall ?? undefined}
              gatedByCompleteness={combined?.gatedByCompleteness ?? false}
              headingRef={verdictHeadingRef}
            />
          )}
```

Update the JSON/CSV export helpers to prefer the combined overall. In `onDownloadJson`, the `result` line stays `const result = verdict ?? response.result;` (per-field comparison) — no change needed there since `verdict` is still the `VerifyResult`. (The combined gating is a UI headline; the exported `result` remains the comparison, consistent with the JSON contract.)

- [ ] **Step 3: Add a test for the gated headline**

In `src/app/VerifyForm.test.tsx`, add this case inside the `describe("VerifyForm — claimed-vs-application verification", ...)` block:

```tsx
  it("shows Needs review (gated by completeness) when the 3 checks pass but a required field is missing", ASYNC, async () => {
    // Net contents omitted -> spirits completeness incomplete -> headline gated to review even though
    // brand/alcohol/warning all match.
    mockFetch({
      provider: "mock",
      readable: true,
      extracted: extractedBourbon({
        netContents: undefined,
        confidence: { brand: 0.98, classType: 0.97, alcoholContent: 0.98, name: 0.95, address: 0.95, warningText: 0.96 },
      }),
      result: null,
    });
    const { container } = render(<VerifyForm />);
    const q = within(container);
    dropLabelImage(container);
    await q.findByText("Extracted from the label");
    fireEvent.change(q.getByLabelText(/Brand name/i), { target: { value: "Old Tom Distillery" } });
    fireEvent.change(q.getByLabelText(/Alcohol content/i), { target: { value: "45% Alc./Vol. (90 Proof)" } });

    expect(await q.findByText("Verification result")).toBeTruthy();
    expect(q.getByText("Needs review")).toBeTruthy();
    expect(q.getByText(/missing a field TTB requires/i)).toBeTruthy();
  });
```

- [ ] **Step 4: Run the component + type checks**

Run: `npx vitest run src/app/VerifyForm.test.tsx`
Expected: PASS (the existing approve/reject tests still pass — `extractedBourbon()` carries name + address so it stays complete; the new gated case shows "Needs review" + the note).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/ResultView.tsx src/app/VerifyForm.tsx src/app/VerifyForm.test.tsx
git commit -m "feat(ui): single-screen verdict gates on completeness, with a plain explanation"
```

---

## Task 5: Gate the batch verdict on completeness too

Keep the batch table consistent with the single screen.

**Files:**
- Modify: `src/batch/csv.ts` (carry a combined `overall` for export)
- Modify: `src/app/batch/BatchVerify.tsx`
- Modify: `src/app/batch/BatchVerify.test.tsx` (mock response gains name/address)

- [ ] **Step 1: Let `AnalysisRow` carry the combined overall**

In `src/batch/csv.ts`, extend the `AnalysisRow` interface:

```ts
export interface AnalysisRow {
  filename: string;
  extracted: ExtractedFields;
  result?: VerifyResult | null;
  completeness?: CompletenessResult;
  /** The headline verdict after gating on completeness; falls back to result.overall. */
  overall?: VerifyResult["overall"] | null;
}
```

In `analysisToCsv`, change the verdict-column `overall` cell from:

```ts
      cells.push(
        v ? v.brand.status : "",
        v ? v.alcohol.status : "",
        v ? v.warning.status : "",
        v ? v.overall : "",
      );
```

to:

```ts
      cells.push(
        v ? v.brand.status : "",
        v ? v.alcohol.status : "",
        v ? v.warning.status : "",
        r.overall ?? (v ? v.overall : ""),
      );
```

- [ ] **Step 2: Update `BatchVerify` to use `combinedVerdict`**

In `src/app/batch/BatchVerify.tsx`:

Change the import:

```tsx
import { verifyLabel, type VerifyResult } from "@/compare";
```

to:

```tsx
import { combinedVerdict, type VerifyResult } from "@/compare";
```

Add a field to `BatchRow`:

```ts
interface BatchRow {
  product: string;
  imageCount: number;
  status: "pending" | "done" | "error";
  extracted?: ExtractedFields;
  completeness?: CompletenessResult;
  result?: VerifyResult | null;
  /** Headline verdict after gating on completeness. */
  overall?: VerifyResult["overall"] | null;
  note?: string;
}
```

In `analyzeProduct`, replace the `result` computation:

```ts
    const result =
      claimedRow?.brand && r.readable
        ? verifyLabel(
            { brand: claimedRow.brand, alcoholContentText: claimedRow.alcoholContent, classType: claimedRow.classType },
            r.extracted,
          )
        : null;
    return {
      ...base,
      status: "done",
      extracted: r.extracted,
      completeness: r.completeness,
      result,
      note: r.readable ? undefined : r.message,
    };
```

with:

```ts
    const combined =
      claimedRow?.brand && r.readable
        ? combinedVerdict(
            { brand: claimedRow.brand, alcoholContentText: claimedRow.alcoholContent, classType: claimedRow.classType },
            r.extracted,
          )
        : null;
    return {
      ...base,
      status: "done",
      extracted: r.extracted,
      completeness: r.completeness,
      result: combined?.verify ?? null,
      overall: combined?.overall ?? null,
      note: r.readable ? undefined : r.message,
    };
```

In the "Application match" cell, drive the badge from the combined overall:

```tsx
                  <td className="px-3 py-2.5">
                    {r.overall ? (
                      <StatusBadge tone={toneForStatus(r.overall)} label={VERDICT_LABEL[r.overall]} />
                    ) : (
                      <span className="text-ink-muted">{claimed.size > 0 ? "no application row" : "—"}</span>
                    )}
                  </td>
```

In `exportCsv`, pass the combined overall into the row:

```ts
        completedRows.map((r) => ({
          filename: r.product,
          extracted: r.extracted as ExtractedFields,
          completeness: r.completeness,
          result: r.result,
          overall: r.overall,
        })),
```

- [ ] **Step 2b: Make the mock response complete so it still Approves**

In `src/app/batch/BatchVerify.test.tsx`, the `RESPONSE.extracted` is a vodka (distilled spirits) missing producer name/address — which now gates to review. Add them so a complete label still Approves:

```ts
  extracted: {
    brand: "Acme",
    classType: "Vodka",
    alcoholContentText: "40% Alc./Vol.",
    netContents: "750 mL",
    name: "Acme Distillery",
    address: "Peoria, IL",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: { brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96, name: 0.95, address: 0.95, warningText: 0.97 },
  },
```

- [ ] **Step 3: Run the batch tests + typecheck**

Run: `npx vitest run src/app/batch/BatchVerify.test.tsx`
Expected: PASS — the matched complete vodka shows "Approve"; the brand-mismatch case shows "Reject".

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/batch/csv.ts src/app/batch/BatchVerify.tsx src/app/batch/BatchVerify.test.tsx
git commit -m "feat(batch): per-product verdict gates on completeness, consistent with the single screen"
```

---

## Task 6: Full green loop + docs

**Files:**
- Modify: `CLAUDE.md` (architecture-as-built bullet for `src/compare/`)
- Modify: `AGENTS.md` (the three checks / verdict note)

- [ ] **Step 1: Run the entire load-bearing loop**

Run: `npm run typecheck && npm run lint && npm test && npm run eval && npm run build`
Expected: typecheck/lint clean; all tests pass; eval prints `APPROVE precision: 100.0% ... PASS`; build succeeds.

- [ ] **Step 2: Note the verdict change in CLAUDE.md**

In `CLAUDE.md`, in the `src/compare/` bullet under "Architecture as built", append after the `thresholds.ts` sentence:

```markdown
  `combinedVerdict` (`reviewVerdict.ts`) is the HEADLINE verdict: it takes the worse of the
  claimed-vs-label comparison (`verifyLabel`) and the per-type completeness check, so a label missing
  a TTB-required field for its beverage type can't be Approved (a missing/malformed mandatory element
  → `review`; the warning keeps its hard fail). The UI + eval read this combined verdict.
```

- [ ] **Step 3: Note it in AGENTS.md**

In `AGENTS.md`, under "## The three checks", add a sentence at the end of the intro (before the bulleted brand/alcohol/warning list) — extend, don't reword the CFR bullets:

```markdown
The overall verdict additionally gates on **per-type completeness**: even when all three checks
pass, a label missing a field TTB requires for its beverage class cannot be Approved (it routes to
review). The three checks below are the claimed-vs-application comparison; completeness is the
label-carries-every-required-element check (`src/compare/completeness.ts`). `combinedVerdict` takes
the worse of the two.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: note the verdict now gates on per-type completeness"
```

---

## Self-review

**Spec coverage (against `2026-06-08-completeness-gated-approval-and-review-worklist-design.md`):**
- §2 "verdict over every required field for the type" → Tasks 1, 3 (eval proof), 4, 5. ✓ (Plan 1 realizes the gate via `combinedVerdict`; the per-field confirm panel and the `reject`-on-confirmed-missing escalation are explicitly deferred to Part 2, noted below.)
- §2 "mandatory gates, conditional never blocks" → inherited from `checkCompleteness` (conditional → `unverifiable` → completeness not `incomplete`); covered by Task 1 tests + the eval. ✓
- §2 "confidence-aware" → low-confidence present already routes completeness to `review`; missing mandatory → `review` in Plan 1 (Part 2 escalates confirmed-missing → `reject`). Partial-by-design, documented. ✓
- §2 AC-4 "eval stays green, floor holds" → Task 3 Step 4. ✓
- §3 confirm-to-approve UX (hybrid) → **deferred to Part 2** (separate plan). Plan 1 surfaces the gate via the verdict + the existing completeness panel + the plain note (Task 4 Step 1). ✓ (scoping is explicit)
- §4 worklist → **deferred to Feature B plan**. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has expected output. ✓

**Type consistency:** `combinedVerdict`/`worstVerdict`/`CombinedVerdict` named identically across Tasks 1, 2, 4, 5. `overall: OverallVerdict | null` from verify.ts. `AnalysisRow.overall` and `BatchRow.overall` both `VerifyResult["overall"] | null`. `ResultView` prop `overall?` + `gatedByCompleteness?` match the `VerifyForm` call site. ✓

**Scope note for the next plan(s):** Part 2 = the confirm-to-approve hybrid UI (AI pre-fills → human confirms-or-corrects; escalates confirmed-missing mandatory → `reject`; per-field confidence routing). Feature B = the review worklist. Both build on `combinedVerdict`.
