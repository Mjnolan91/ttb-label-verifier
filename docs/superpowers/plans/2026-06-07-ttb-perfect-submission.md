# TTB Verifier "Perfect Submission" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition the app so verifying a label against an application is front-and-center, fix the brand/producer-name extraction defect, align completeness to current 27 CFR law, add an accessible click-to-zoom image view, collapse the field set to a single source of truth, and remove dead files — keeping `typecheck → lint → test → eval` green throughout.

**Architecture:** Next.js (App Router) + TS strict + Tailwind v4 + Vitest. Pipeline is `image → VisionProvider(s) → reconcile/merge → completeness + optional comparator → UI`. The deterministic `src/domain` + `src/compare` modules own all pass/fail logic; `src/extraction` owns probabilistic reads; `src/app` is the single-screen UI + `/api/verify`. We change behavior, never reword an in-force CFR constant.

**Tech Stack:** TypeScript, React 19, Tailwind v4, Vitest (+ `@testing-library/react` under jsdom for component tests), tsx eval harness.

**Reference spec:** `docs/superpowers/specs/2026-06-07-ttb-verifier-perfect-submission-design.md`

**Conventions for every task:**
- Tests: `npx vitest run <file>` (single file), `npm test` (full). Component tests need a `// @vitest-environment jsdom` docblock.
- Gates before each commit where logic changed: `npm run typecheck && npm run lint && npm test` (and `npm run eval` when domain/completeness/extraction changed).
- Commit messages use Conventional Commits; end with the Co-Authored-By trailer.

---

## Phase 0: Baseline

### Task 0: Confirm a green baseline
**Files:** none.
- [ ] **Step 1:** Run `npm run typecheck && npm run lint && npm test && npm run eval`. Expected: all pass (eval above `APPROVE_PRECISION_FLOOR` 0.98). If anything is red on a clean checkout, stop and report before changing code.
- [ ] **Step 2:** Run `printenv VISION_PROVIDER` (or check `.env.local`). Record which provider is active — confirms whether the reported brand/name symptom is the mock blind spot (Phase 4) or a real-provider prompt issue. Either fix lands regardless.

---

## Phase 1: Repo cleanup (Workstream F, part 1)

### Task 1: Delete dead `public/samples/` and trim its generator
**Files:**
- Delete: `public/samples/` (7 files)
- Modify: `scripts/generate-demo-labels.cjs` (remove the `public/samples` output target; keep only `eval/fixtures/images` generation, or delete the file if that's all it did)
- Grep first: confirm zero code references.

- [ ] **Step 1:** Confirm dead: `git grep -nE "samples|SAMPLES" -- src/ ':!*.md'`. Expected: no hits in `src/`. (Hits in docs are fine — fixed in Phase 9.)
- [ ] **Step 2:** `git rm -r public/samples`
- [ ] **Step 3:** Open `scripts/generate-demo-labels.cjs`; if it writes to both `eval/fixtures/images` and `public/samples`, remove the `public/samples` writes. If `public/samples` was its only purpose, `git rm scripts/generate-demo-labels.cjs`.
- [ ] **Step 4:** `npm run build` (or `npm run typecheck`) to confirm nothing imported the deleted assets. Expected: pass.
- [ ] **Step 5:** Commit: `chore: remove dead public/samples assets and trim demo-label generator`.

---

## Phase 2: Law correctness in domain + completeness (Workstream C)

### Task 2: Remove the two dead extracted fields (`beverageClass`, structured `alcoholContent`)
**Files:**
- Modify: `src/domain/types.ts` (`ExtractedFields`, `FieldConfidence`)
- Modify: `src/compare/completeness.ts:74,138-139`
- Verify no other readers: `src/compare/comparators.ts`, `src/app/VerifyForm.tsx`

- [ ] **Step 1:** Grep readers: `git grep -nE "\.beverageClass|extracted\.alcoholContent\b|\.alcoholContent\?\.|e\.alcoholContent" -- src/`. Confirm the only `ExtractedFields.beverageClass` / structured `ExtractedFields.alcoholContent` readers are in `completeness.ts`. (The comparator reads `alcoholContentText` and `ClaimedFields.alcoholContent`; `ClaimedFields.alcoholContent` STAYS.)
- [ ] **Step 2:** In `src/domain/types.ts`, delete the `beverageClass?: BeverageClass;` line from `ExtractedFields` (the `/** Normalized beverage class inferred... */`) and the structured `alcoholContent?: AlcoholContent;` line (the `/** ...optional pre-parsed form. */`). In `FieldConfidence`, delete `beverageClass?: number;`. Keep `AlcoholContent`, `ClaimedFields.alcoholContent`, and `alcoholContentText`.
- [ ] **Step 3:** `npm run typecheck`. Expected: FAIL in `completeness.ts` (references to the removed fields). This pins the readers to fix in Task 3.
- [ ] **Step 4:** (Compiles after Task 3.) Defer commit until Task 3.

### Task 3: Parse ABV from text in completeness (fix F1 exemption + F5 class resolution)
**Files:**
- Modify: `src/compare/completeness.ts`
- Read first: `src/compare/alcohol.ts` (use its existing ABV-from-text parser + `resolveBeverageClass`)
- Test: `src/compare/completeness.test.ts`

- [ ] **Step 1:** Read `src/compare/alcohol.ts`; identify the function that parses an ABV number from `alcoholContentText` (e.g. `parseAlcoholText`/`parseAbv`) and `resolveBeverageClass(classType, abv)`. Note the exact exported names.
- [ ] **Step 2: Write failing tests** in `completeness.test.ts`:

```ts
it("treats a text-only sub-0.5% ABV as warning-exempt (no structured field)", () => {
  const res = checkCompleteness(make({
    classType: "Non-Alcoholic Malt Beverage",
    alcoholContentText: "0.3% Alc./Vol.",
    warningText: "", // confidently absent
  }));
  const warn = res.elements.find((e) => e.key === "governmentWarning")!;
  expect(warn.status).toBe("unverifiable"); // exempt, not "missing"
});

it("keeps the warning required when ABV is unknown and absent", () => {
  const res = checkCompleteness(make({ classType: "Vodka", warningText: "" }));
  const warn = res.elements.find((e) => e.key === "governmentWarning")!;
  expect(warn.status).toBe("missing");
});
```
(Use the file's existing `make`/fixture helper; if none, build an `ExtractedFields` inline with `confidence: {}` and the two warning booleans.)
- [ ] **Step 3:** Run `npx vitest run src/compare/completeness.test.ts`. Expected: FAIL (exemption currently keys off the removed structured field).
- [ ] **Step 4: Implement.** In `completeness.ts`:
  - Import the text parser from `./alcohol`.
  - Add a local helper `function abvFromText(e: ExtractedFields): number | undefined { return e.alcoholContentText ? parseAbv(e.alcoholContentText) : undefined; }` (use the real parser name).
  - In `checkCompleteness`, change class resolution to: `const abv = abvFromText(extracted); const beverageClass = resolveBeverageClass(extracted.classType, abv);` (drop `extracted.beverageClass ??`).
  - In `evalWarning`, replace `const abv = e.alcoholContent?.abv;` with `const abv = abvFromText(e);`.
- [ ] **Step 5:** Run `npx vitest run src/compare/completeness.test.ts` then `npm run typecheck`. Expected: PASS (Task 2 now compiles too).
- [ ] **Step 6:** `npm test && npm run eval`. Expected: green, eval above floor.
- [ ] **Step 7:** Commit (Tasks 2+3): `fix(completeness): parse ABV from text for the 0.5% warning exemption; drop two dead extracted fields`.

### Task 4: Sulfite to conditional/advisory (fix F2 — match 27 CFR 4.32(e))
**Files:**
- Modify: `src/domain/labelRequirements.ts` (`SULFITES`, and its module-header note)
- Modify: `src/compare/completeness.ts` (ensure a conditional absent sulfite → `unverifiable` with the advisory note — already the generic path once `necessity: "conditional"`)
- Test: `src/compare/completeness.test.ts`

- [ ] **Step 1: Write/adjust failing test:**
```ts
it("does not mark a sulfite-free wine incomplete (sulfite is conditional, >=10 ppm)", () => {
  const res = checkCompleteness(make({
    classType: "Table Wine", brand: "X", netContents: "750 mL",
    name: "Y Winery", address: "Napa, CA",
    warningText: GOVERNMENT_WARNING_TEXT, // canonical; import from domain
    // no sulfiteDeclaration
  }));
  const s = res.elements.find((e) => e.key === "sulfiteDeclaration")!;
  expect(s.status).toBe("unverifiable");
  expect(res.overall).not.toBe("incomplete");
});
```
(If a prior test asserted the opposite — discovery noted `completeness.test.ts:61-70` expects sulfite-free wine `incomplete` — update that test to the new, law-correct expectation.)
- [ ] **Step 2:** `npx vitest run src/compare/completeness.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `labelRequirements.ts`, change `SULFITES.necessity` from `"mandatory"` to `"conditional"`, and update its `note` to: `'"Contains Sulfites" required only at >= 10 ppm SO2 (27 CFR 4.32(e)); not determinable from the image, so surfaced for review, never failed.'` Update the module-header bullet about sulfites to describe the conditional treatment (remove the "modeled MANDATORY" simplification language).
- [ ] **Step 4:** `npx vitest run src/compare/completeness.test.ts && npm test && npm run eval`. Expected: green.
- [ ] **Step 5:** Commit: `fix(domain): model sulfite declaration as conditional (27 CFR 4.32(e)), not mandatory-for-wine`.

### Task 5: Give `unknown` class a conditional country-of-origin (fix F3)
**Files:**
- Modify: `src/domain/labelRequirements.ts:125`
- Test: `src/domain/labelRequirements.test.ts` (or `completeness.test.ts`)

- [ ] **Step 1: Write failing test:**
```ts
it("includes a conditional country-of-origin for the unknown class", () => {
  const keys = mandatoryElementsFor("unknown").map((s) => s.key);
  expect(keys).toContain("countryOfOrigin");
});
```
- [ ] **Step 2:** `npx vitest run src/domain/labelRequirements.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Change the `unknown` row to `[...COMMON_HEAD, ALC_MANDATORY, ...COMMON_TAIL, COUNTRY_OF_ORIGIN]` and update its inline comment.
- [ ] **Step 4:** `npx vitest run src/domain/labelRequirements.test.ts && npm test`. Expected: green.
- [ ] **Step 5:** Commit: `fix(domain): add conditional country-of-origin to the unknown beverage class`.

### Task 6: Make warning bold/caps severity consistent across both paths (Workstream C)
**Files:**
- Read: `src/compare/comparators.ts` (the warning comparator, ~`:234`)
- Modify: `src/compare/comparators.ts`
- Test: `src/compare/comparators.test.ts`

- [ ] **Step 1:** Read the warning comparator. Confirm current behavior: `warningPrefixIsBold === false` → hard `fail`; `null` → ? Decide the consistent rule (matches completeness): **all-caps false = fail; bold `false` = advisory note (still pass on the format gate, surfaced for human check); bold `null` = no assertion.**
- [ ] **Step 2: Write/adjust failing test** asserting a label with correct text + ALL-CAPS prefix + `warningPrefixIsBold: false` returns the non-fail verdict with an advisory note (not `reject` purely for bold). Also assert `null` bold never fails.
- [ ] **Step 3:** `npx vitest run src/compare/comparators.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** In the warning comparator, change the `bold === false` branch from a hard fail to appending an advisory note while keeping the verdict driven by text-match + all-caps. Keep `null` as no-assertion. Preserve the all-caps hard-fail.
- [ ] **Step 5:** `npx vitest run src/compare/comparators.test.ts && npm test && npm run eval`. Expected: green, eval above floor.
- [ ] **Step 6:** Commit: `fix(compare): make warning bold severity advisory (consistent with completeness); keep all-caps a hard fail`.

---

## Phase 3: Single source of truth for the field set (Workstream E)

### Task 7: Introduce the field catalog
**Files:**
- Create: `src/extraction/fieldCatalog.ts`
- Test: `src/extraction/fieldCatalog.test.ts`

- [ ] **Step 1: Write the catalog + test.** Create `fieldCatalog.ts`:
```ts
import type { ExtractedFields, FieldConfidence } from "@/domain";

/** Keys on ExtractedFields that hold a string value carried as {value, confidence}. */
export type ExtractedValueKey = Extract<keyof ExtractedFields,
  "brand" | "class" | "classType" | "alcoholContentText" | "netContents" | "warningText"
  | "name" | "address" | "countryOfOrigin" | "appellation" | "vintage" | "varietal"
  | "sulfiteDeclaration" | "ageStatement" | "commodityStatement">;

export interface FieldDescriptor {
  key: ExtractedValueKey;            // ExtractedFields value key
  rawKey: string;                    // RawExtractedFields key (differs only for alcohol)
  confKey: keyof FieldConfidence;    // confidence channel
  label: string;                     // human label (UI/CSV header)
  csvColumn: string;                 // CSV column id
  group: "headline" | "detail";      // progressive-disclosure grouping
}

/** THE ordered field list. Every plumbing layer derives from this — edit here only. */
export const FIELD_CATALOG: FieldDescriptor[] = [
  { key: "brand", rawKey: "brand", confKey: "brand", label: "Brand name", csvColumn: "brand", group: "headline" },
  { key: "classType", rawKey: "classType", confKey: "classType", label: "Class / type", csvColumn: "type", group: "headline" },
  { key: "class", rawKey: "class", confKey: "class", label: "Broad category", csvColumn: "class", group: "detail" },
  { key: "alcoholContentText", rawKey: "alcoholContent", confKey: "alcoholContent", label: "Alcohol content", csvColumn: "alcohol", group: "headline" },
  { key: "netContents", rawKey: "netContents", confKey: "netContents", label: "Net contents", csvColumn: "net_contents", group: "headline" },
  { key: "warningText", rawKey: "warningText", confKey: "warningText", label: "Government warning", csvColumn: "warning_text", group: "headline" },
  { key: "name", rawKey: "name", confKey: "name", label: "Producer / bottler name", csvColumn: "name", group: "detail" },
  { key: "address", rawKey: "address", confKey: "address", label: "Producer / bottler address", csvColumn: "address", group: "detail" },
  { key: "countryOfOrigin", rawKey: "countryOfOrigin", confKey: "countryOfOrigin", label: "Country of origin", csvColumn: "country_of_origin", group: "detail" },
  { key: "appellation", rawKey: "appellation", confKey: "appellation", label: "Appellation", csvColumn: "appellation", group: "detail" },
  { key: "vintage", rawKey: "vintage", confKey: "vintage", label: "Vintage", csvColumn: "vintage", group: "detail" },
  { key: "varietal", rawKey: "varietal", confKey: "varietal", label: "Varietal", csvColumn: "varietal", group: "detail" },
  { key: "sulfiteDeclaration", rawKey: "sulfiteDeclaration", confKey: "sulfiteDeclaration", label: "Sulfite declaration", csvColumn: "sulfites", group: "detail" },
  { key: "ageStatement", rawKey: "ageStatement", confKey: "ageStatement", label: "Age statement", csvColumn: "age_statement", group: "detail" },
  { key: "commodityStatement", rawKey: "commodityStatement", confKey: "commodityStatement", label: "Commodity statement", csvColumn: "commodity_statement", group: "detail" },
];
```
Test `fieldCatalog.test.ts`: assert keys are unique, csvColumns unique, and every catalog `key` exists on a sample `ExtractedFields` (type-level + runtime presence in `mapRawExtracted` output once wired).
- [ ] **Step 2:** `npx vitest run src/extraction/fieldCatalog.test.ts`. Expected: PASS (pure data).
- [ ] **Step 3:** Commit: `feat(extraction): add FIELD_CATALOG single source of truth for the extracted field set`.

### Task 8: Derive `mapRawExtracted` from the catalog
**Files:**
- Modify: `src/extraction/extractedShape.ts`
- Test: `src/extraction/extractedShape.test.ts` (create if absent)

- [ ] **Step 1: Write failing test** asserting `mapRawExtracted` round-trips a representative raw block (brand/classType/alcoholContent/name/address/sulfite) into the right value + confidence keys, including the `alcoholContent` rawKey → `alcoholContentText` value + `alcoholContent` confKey mapping.
- [ ] **Step 2:** `npx vitest run src/extraction/extractedShape.test.ts`. Expected: FAIL (no test/file) → write minimal, then iterate.
- [ ] **Step 3: Implement.** Rewrite `mapRawExtracted` to iterate `FIELD_CATALOG`:
```ts
export function mapRawExtracted(raw: RawExtractedFields): ExtractedFields {
  const confidence: FieldConfidence = {};
  const out = {
    warningPrefixIsAllCaps: raw.warningPrefixIsAllCaps,
    warningPrefixIsBold: raw.warningPrefixIsBold,
    confidence,
  } as ExtractedFields;
  for (const d of FIELD_CATALOG) {
    const cell = (raw as Record<string, RawConfidencedValue | undefined>)[d.rawKey];
    if (cell) {
      (out as Record<string, unknown>)[d.key] = cell.value;
      confidence[d.confKey] = cell.confidence;
    }
  }
  return out;
}
```
- [ ] **Step 4:** `npx vitest run src/extraction/extractedShape.test.ts && npm run typecheck && npm test`. Expected: green.
- [ ] **Step 5:** Commit: `refactor(extraction): derive mapRawExtracted from FIELD_CATALOG`.

### Task 9: Derive merge field lists from the catalog
**Files:**
- Modify: `src/extraction/reconcile.ts:83-119`
- Test: `src/extraction/reconcile.test.ts`

- [ ] **Step 1:** Replace the hand-maintained `VALUE_FIELDS` array and `CONF_KEY` map with derivations:
```ts
const VALUE_FIELDS = FIELD_CATALOG.map((d) => d.key);
type ValueField = (typeof VALUE_FIELDS)[number];
const CONF_KEY: Record<ValueField, keyof FieldConfidence> =
  Object.fromEntries(FIELD_CATALOG.map((d) => [d.key, d.confKey])) as Record<ValueField, keyof FieldConfidence>;
```
- [ ] **Step 2:** `npm run typecheck && npx vitest run src/extraction/reconcile.test.ts && npm test`. Expected: green (existing merge tests still pass — same field set).
- [ ] **Step 3:** Commit: `refactor(extraction): derive reconcile field lists from FIELD_CATALOG`.

### Task 10: Drive the field table + CSV from the catalog (fixes CSV≠JSON)
**Files:**
- Modify: `src/app/ui/ExtractedFieldsView.tsx`
- Modify: `src/app/ui/csv.ts`
- Test: `src/app/ui/csv.test.ts`

- [ ] **Step 1: Write failing test** in `csv.test.ts` asserting the CSV header includes every `FIELD_CATALOG[*].csvColumn` (so wine/spirits fields are no longer dropped) and that a row populates them from `ExtractedFields`.
- [ ] **Step 2:** `npx vitest run src/app/ui/csv.test.ts`. Expected: FAIL (current CSV omits several columns).
- [ ] **Step 3: Implement.** In `csv.ts`, build the extracted-field columns by iterating `FIELD_CATALOG` (column id = `csvColumn`, value = `extracted[key]`, plus `<col>_conf` from `confidence[confKey]` for the headline group as today). Keep the warning flags + completeness/verdict columns. In `ExtractedFieldsView.tsx`, render one `<Row>` per catalog entry (label = `d.label`, value = `extracted[d.key]`, confidence = `confidence[d.confKey]`), split into `headline` vs `detail` groups for Task 13's progressive disclosure.
- [ ] **Step 4:** `npx vitest run src/app/ui/csv.test.ts && npm run typecheck && npm test`. Expected: green.
- [ ] **Step 5:** Commit: `refactor(ui): render field table + CSV from FIELD_CATALOG (JSON and CSV now agree)`.

---

## Phase 4: Brand / producer-name / class extraction (Workstream B)

### Task 11: Loosen `valuesAgree` containment + fix the producer tie-break
**Files:**
- Modify: `src/extraction/reconcile.ts` (`valuesAgree`, and the `ha && hb` branch in `mergeExtracted`)
- Test: `src/extraction/reconcile.test.ts`

- [ ] **Step 1: Write failing tests:**
```ts
it("treats containment of a short identity field as agreement, not disagreement", () => {
  const front = makeExtract({ name: "OLD TOM", nameConf: 0.9 });
  const back = makeExtract({ name: "Old Tom Distillery", nameConf: 0.9 });
  const merged = mergeExtracted(front, back);
  expect(merged.name).toBe("Old Tom Distillery");        // prefer the more complete producer value
  expect(merged.confidence.name ?? 0).toBeGreaterThanOrEqual(0.9); // not cratered to 0.3
});
```
- [ ] **Step 2:** `npx vitest run src/extraction/reconcile.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `valuesAgree`, before the similarity check, add containment for short identity values: if one canonical string contains the other and the shorter is ≥ 3 chars, return `true`.
  - In `mergeExtracted`'s `ha && hb` agree-branch, when the two values agree **by containment**, set `out[f]` to the **longer** value (more complete) rather than the higher-confidence one, for the identity fields `name`/`address`/`brand`. Keep `Math.max` confidence on agreement.
  - Guard the change so non-identity fields keep current behavior.
- [ ] **Step 4:** `npx vitest run src/extraction/reconcile.test.ts && npm test && npm run eval`. Expected: green, eval above floor.
- [ ] **Step 5:** Commit: `fix(extraction): containment-aware agreement + prefer more-complete producer value in merge`.

### Task 12: Rewrite the prompt's brand/name/class disambiguation
**Files:**
- Modify: `src/extraction/LlmVisionProvider.ts` (`SYSTEM_PROMPT`/`USER_PROMPT`, ~`:114-165`)
- Test: covered indirectly (prompt is prose); add a doc assertion test only if a prompt-snapshot test already exists.

- [ ] **Step 1:** Edit the brand rule to: *"brand: the FANCIFUL product/brand mark (often the largest text or a logo wordmark). This is NOT automatically the bottling company — the legally responsible company belongs in `name`. If the same words serve as both the brand mark AND the responsible company, populate BOTH `brand` and `name` with them."* Replace the `"OLD TOM DISTILLERY"` brand example with a brand≠producer example, e.g. brand `"Single Barrel"` / name `"ABC Distillery"`.
- [ ] **Step 2:** Add to the name rule: *"`name` and `address` are PARSED OUT of the responsibility statement; populate all of `name`, `address`, and `commodityStatement` from the same printed line — do not leave name/address empty just because commodityStatement is filled."*
- [ ] **Step 3:** Edit the `class` rule: *"class: a broad category DERIVED from the printed designation (this is the one field you may infer, e.g. classType 'Kentucky Straight Bourbon Whiskey' → class 'Whisky'). classType must stay verbatim."* (Keeps Hard Rule #2 verbatim for everything except this explicitly-derived field.)
- [ ] **Step 4:** `npm run typecheck && npm test`. Expected: green (no logic change). If a prompt snapshot test exists, update it.
- [ ] **Step 5:** Commit: `fix(extraction): disambiguate brand vs producer name and derive broad class in the prompt`.

### Task 13: Make completeness fall back classType → class; seed fixtures with name/address/class
**Files:**
- Modify: `src/compare/completeness.ts` (`fieldFor` for `classType`)
- Modify: `eval/fixtures/cases.json` (add `name`/`address`/`class` blocks to the existing clean cases)
- Test: `src/compare/completeness.test.ts`

- [ ] **Step 1: Write failing test:** a label with `class: "Whisky"` but empty `classType` reports the class/type element `present` (via fallback), not `missing`.
- [ ] **Step 2:** `npx vitest run src/compare/completeness.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `fieldFor`, the `classType` case returns `{ value: e.classType?.trim() ? e.classType : e.class, confidence: e.confidence.classType ?? e.confidence.class }`.
- [ ] **Step 4:** In `cases.json`, add `name`, `address`, and `class` `{value, confidence}` blocks to the clean spirits/wine cases (match the real artwork the fixtures represent, e.g. name `"ABC Distillery"`, address `"Frederick, MD"`, class `"Whisky"`). Do NOT alter the deliberately-broken cases' broken fields.
- [ ] **Step 5:** `npx vitest run src/compare/completeness.test.ts && npm test && npm run eval`. Expected: green; eval still ≥ floor (new fixture fields should improve, not regress, completeness). Adjust fixture expectations in `cases.json` if the eval harness compares per-field.
- [ ] **Step 6:** Commit: `fix(compare): fall back classType→class; seed fixtures with producer name/address/class`.

---

## Phase 5: Accessible click-to-zoom image view (Workstream D, part 1)

### Task 14: Build a reusable accessible image lightbox
**Files:**
- Create: `src/app/ui/ImageLightbox.tsx`
- Test: `src/app/ui/ImageLightbox.test.tsx` (jsdom)

- [ ] **Step 1: Write failing component test** (`// @vitest-environment jsdom`):
```tsx
it("opens to the image, closes on Escape, and returns focus to the trigger", async () => {
  render(<LightboxHarness src="/x.png" alt="Front label" />);
  const trigger = screen.getByRole("button", { name: /enlarge front label/i });
  trigger.focus();
  await userEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: /front label/i });
  expect(within(dialog).getByRole("img", { name: /front label/i })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
```
(`LightboxHarness` is a tiny wrapper in the test that wires a trigger button to the lightbox open state.)
- [ ] **Step 2:** `npx vitest run src/app/ui/ImageLightbox.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `ImageLightbox.tsx`: a controlled overlay — `role="dialog"`, `aria-modal="true"`, `aria-label={alt}`; renders the image `object-contain` near-viewport; a large labeled close button; closes on Escape and backdrop click; traps focus within the dialog (focus the close button on open) and restores focus to the opener on close; honors `prefers-reduced-motion` (no transition when set). Use a portal if the codebase has one; otherwise a fixed-position overlay is fine.
- [ ] **Step 4:** `npx vitest run src/app/ui/ImageLightbox.test.tsx && npm run typecheck && npm run lint`. Expected: green.
- [ ] **Step 5:** Commit: `feat(ui): accessible ImageLightbox (dialog, focus trap, Esc/backdrop close)`.

### Task 15: Make thumbnails clickable + bigger across single + batch
**Files:**
- Modify: `src/app/VerifyForm.tsx:218-223` (thumbnail markup)
- Modify: `src/app/batch/BatchVerify.tsx` (after Task 18 unifies; if before, at least add thumbnails)
- Reuse: `ImageLightbox`

- [ ] **Step 1:** Replace the bare 64px `<img>` with a `<button>` (≈112px) wrapping the image: `aria-label={`Enlarge ${img.file.name}`}`, `cursor-zoom-in`, hover ring, a small magnifier badge overlay. Clicking opens `ImageLightbox` with `img.preview` + the filename as alt.
- [ ] **Step 2:** Ensure the object URL isn't revoked while the lightbox is open (guard `removeImage`/cleanup).
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test`. Add a small VerifyForm component test asserting a thumbnail button exists with the enlarge label.
- [ ] **Step 4:** Manual: `npm run dev`, upload a sample image, click the thumbnail, verify zoom + Esc + focus return. (Use the running app per the `run` skill.)
- [ ] **Step 5:** Commit: `feat(ui): clickable, larger thumbnails open the image lightbox`.

---

## Phase 6: Verify-first repositioning (Workstream A + D, part 2)

### Task 16: Reposition the single screen around the verdict
**Files:**
- Modify: `src/app/VerifyForm.tsx` (layout/order, headline, application form placement)
- Read first: `src/app/ResultView.tsx`, `src/app/ui/StatusBadge.tsx`, `src/app/ui/CompletenessView.tsx`
- Test: `src/app/VerifyForm.test.tsx` (jsdom; create if absent)

- [ ] **Step 1:** Make the "What does the application say?" form (brand, ABV, beverage class, "warning required" checkbox) **always visible** beneath the upload zone (not gated behind a successful read). Keep auto-extract on upload.
- [ ] **Step 2:** Render a single **headline** region at the top of results: when application values are present, show the `ResultView` Approve/Needs-review/Reject verdict with the three labeled check rows (brand/ABV/warning) and plain-language reasons; otherwise show the completeness summary headline ("This label looks complete" / "Needs a human to check N items" / "Incomplete — N required elements missing"). Move `CompletenessView` and `ExtractedFieldsView` BELOW the headline as supporting detail.
- [ ] **Step 3: Write component tests:** (a) with image + brand+ABV+class entered → an Approve/Review/Reject banner with three check rows renders; (b) with image + no application values → completeness headline renders; (c) no tab/mode control exists.
- [ ] **Step 4:** `npx vitest run src/app/VerifyForm.test.tsx && npm run typecheck && npm run lint && npm test`. Expected: green.
- [ ] **Step 5:** Manual pass via `npm run dev`. Screenshot the verify result and the read-only result.
- [ ] **Step 6:** Commit: `feat(ui): verify-first single screen — lead with the verdict, extraction as supporting detail`.

### Task 17: Progressive disclosure + plainer language + "Read again"
**Files:**
- Modify: `src/app/ui/ExtractedFieldsView.tsx` (headline vs detail groups, "Show everything we read" expander)
- Modify: `src/app/VerifyForm.tsx` (Read-again button; copy)
- Modify: copy in `VerifyForm.tsx`/`ExtractedFieldsView.tsx` ("AI confidence" not "conf."; inline-explain "COLA application"; reword "Check against the application")

- [ ] **Step 1:** In `ExtractedFieldsView`, show only `group: "headline"` fields by default; put `group: "detail"` fields behind a `<details>`/disclosure "Show everything we read (N fields)". Keep raw JSON in its existing `<details>`.
- [ ] **Step 2:** Replace `conf.` header with `AI confidence`; replace `N/A` rendering for `unverifiable` with `Not applicable`; add an inline one-liner explaining "the application (COLA)". Add a visible "Read again" button on the result that re-POSTs the current images.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test`. Add/extend a component test asserting detail fields are hidden until the disclosure is opened.
- [ ] **Step 4:** Commit: `feat(ui): progressive disclosure of fields, plainer copy, and a Read-again action`.

### Task 18: Unify batch onto the shared DropZone + thumbnails
**Files:**
- Modify: `src/app/batch/BatchVerify.tsx` (use `DropZone` + the clickable-thumbnail component instead of the bare file input)
- Read: `src/app/ui/DropZone.tsx`

- [ ] **Step 1:** Replace the raw `<input type=file multiple>` with the shared `DropZone`; render the same clickable thumbnail strip (lightbox-enabled). Keep the explicit "Read all labels" button + progress + results table (batch keeps a manual trigger by design).
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm test`. Manual: upload several files to `/batch`, confirm thumbnails + zoom work.
- [ ] **Step 3:** Commit: `feat(ui): unify batch upload onto the shared DropZone + thumbnails`.

---

## Phase 7: Forward-looking regulatory note (Workstream C, UI)

### Task 19: Add a non-blocking "forward-looking" expander
**Files:**
- Create: `src/app/ui/ForwardLookingNote.tsx`
- Modify: `src/app/VerifyForm.tsx` (render it near the result footer, collapsed)
- Test: `src/app/ui/ForwardLookingNote.test.tsx` (jsdom)

- [ ] **Step 1: Write failing test:** the component renders collapsed, exposes a disclosure, and on expand lists the three proposals each marked "Proposed — not yet required": Surgeon-General cancer warning, "Alcohol Facts" panel (NPRM Notice 237), Major Food Allergen labeling (NPRM Notice 238).
- [ ] **Step 2:** `npx vitest run src/app/ui/ForwardLookingNote.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** a small collapsed `<details>` with the three items, each with a one-line plain-language description and the "proposed, not yet required (as of 2026)" tag. No enforcement, no effect on the verdict.
- [ ] **Step 4:** `npx vitest run src/app/ui/ForwardLookingNote.test.tsx && npm run typecheck && npm run lint && npm test`. Expected: green.
- [ ] **Step 5:** Commit: `feat(ui): forward-looking note for 2025 TTB proposals (display-only, not enforced)`.

---

## Phase 8: Docs refresh (Workstream F, part 2 — covers "/init")

### Task 20: Refresh CLAUDE.md / AGENTS.md / README.md
**Files:**
- Modify: `CLAUDE.md`, `AGENTS.md`, `README.md`, `src/app/ui/StatusBadge.tsx` (stale "sample buttons" comment)

- [ ] **Step 1:** Remove every claim of a "one-click samples" / `public/samples` feature. Update mock-mode guidance to: *"the mock recognizes only the built-in eval fixtures (keyed by filename); set `VISION_PROVIDER=openai` (or Azure) to read any uploaded image; the deployed URL runs a real provider."*
- [ ] **Step 2:** Update architecture notes to reflect: verify-first UI, the `FIELD_CATALOG` single source of truth, the two removed dead fields, sulfite-conditional, and the forward-looking note. Keep AGENTS.md's CFR sections (they're correct) — only fix drift.
- [ ] **Step 3:** Remove the stale "sample buttons" comment in `StatusBadge.tsx`.
- [ ] **Step 4:** Re-read all three docs end-to-end; confirm no statement is contradicted by code.
- [ ] **Step 5:** Commit: `docs: refresh CLAUDE/AGENTS/README for verify-first, field catalog, and honest mock-mode guidance`.

---

## Phase 9: Final verification + deploy prep (Workstream G)

### Task 21: Full green sweep + eval
- [ ] **Step 1:** `npm run typecheck && npm run lint && npm test && npm run eval`. Expected: all pass; eval above `APPROVE_PRECISION_FLOOR` (0.98). Fix any regression before proceeding.
- [ ] **Step 2:** `npm run build` (standalone). Expected: clean production build.
- [ ] **Step 3:** Manual keyboard-only a11y walk: upload → zoom (Esc/focus return) → fill application → verify → download JSON/CSV → forward-looking note. Confirm no aria-live + focus-move double-announcement on the completeness region (discovery flagged `CompletenessView` aria-live vs the focus move).

### Task 22: Deploy-readiness (needs Matt's provider key/creds)
- [ ] **Step 1:** Verify `.env.example` documents the real-provider vars; confirm README "Deploying to Azure" steps are accurate against the current Dockerfile + `output: "standalone"`.
- [ ] **Step 2:** With a provided OpenAI key (or Azure creds) set `VISION_PROVIDER` and smoke-test reading a real uploaded label end-to-end (latency within ~5 s budget). [Blocked on Matt supplying the key.]
- [ ] **Step 3:** Final commit / PR: `feat: verify-first TTB label verifier — law-accurate completeness, brand/name fix, click-to-zoom, field catalog, cleanup`.

---

## Self-review (spec coverage)

- **A (verify-first):** Tasks 16, 17. ✓
- **B (brand/name):** Tasks 11, 12, 13 (+ Task 0 provider check). ✓
- **C (law):** Tasks 2–6 (F1, F2, F3, F5, bold/caps) + Task 19 (forward-looking note). ✓
- **D (UI ease + zoom):** Tasks 14, 15, 16, 17, 18. ✓
- **E (single source of truth):** Tasks 7–10 (+ dead-field removal in Task 2). ✓
- **F (hygiene + docs):** Tasks 1, 20. ✓
- **G (deploy):** Tasks 21, 22. ✓

**Type consistency:** `FIELD_CATALOG`/`FieldDescriptor`/`ExtractedValueKey` are defined once (Task 7) and consumed by Tasks 8–10; `mapRawExtracted` signature unchanged; `mandatoryElementsFor`/`checkCompleteness` signatures unchanged. `ImageLightbox` API (Task 14) reused by Tasks 15, 18.

**Open items (from spec §7):** active `VISION_PROVIDER` (Task 0); deploy creds (Task 22) — both confirmed at runtime, neither blocks the code work.
