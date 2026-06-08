# Front/Back Slots + Batch Verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the single screen explicit Front/Back drop slots, and add batch verify-against-application via an application-values CSV (wiring the existing `parseClaimedCsv`/`verifyLabel`/verdict-columns and removing that dead code).

**Architecture:** Feature A is contained to `VerifyForm` state + JSX (slots replace the auto-guess dropdown; the `/api/verify` multipart contract is unchanged). Feature B adds a pure matcher `src/batch/claimedMatch.ts` and wires `BatchVerify` to parse a claimed CSV, run the existing `verifyLabel` per product, and surface a verdict badge + verdict CSV columns.

**Tech Stack:** Next.js + React 19 + TS strict + Tailwind v4 + Vitest (jsdom for component tests).

**Reference spec:** `docs/superpowers/specs/2026-06-08-batch-verify-and-upload-slots-design.md`

**Gate before each commit:** `npm run typecheck && npm run lint && npx vitest run` (eval only if domain/comparator change — none here). Use `; echo "exit:$?"` to read true exit codes (don't pipe the gate through `tail`).

---

## Phase 1 — Feature A: Front/Back drop slots

### Task 1: Replace the dropzone+dropdown with Front/Back slots
**Files:**
- Modify: `src/app/VerifyForm.tsx`
- Modify: `src/app/VerifyForm.test.tsx`

- [ ] **Step 1: State + handlers.** Replace `const [images, setImages] = useState<LabelImage[]>([])` and `guessPosition`/`addFiles`/`setPosition`/`removeImage` with two slots:
```tsx
type SlotKey = "front" | "back";
const [slots, setSlots] = useState<{ front?: LabelImage; back?: LabelImage }>({});
const orderedImages = ([slots.front, slots.back].filter(Boolean) as LabelImage[]);

function setSlot(key: SlotKey, file: File) {
  setSlots((prev) => {
    if (prev[key]) URL.revokeObjectURL(prev[key]!.preview); // replacing -> revoke old
    if (zoom?.src === prev[key]?.preview) setZoom(null);
    const next = { ...prev, [key]: { file, preview: URL.createObjectURL(file), position: key as LabelPosition } };
    void read([next.front, next.back].filter(Boolean) as LabelImage[]);
    return next;
  });
}
function clearSlot(key: SlotKey) {
  setSlots((prev) => {
    const target = prev[key];
    if (target) { if (zoom?.src === target.preview) setZoom(null); URL.revokeObjectURL(target.preview); }
    const next = { ...prev, [key]: undefined };
    const imgs = [next.front, next.back].filter(Boolean) as LabelImage[];
    if (imgs.length === 0) { readToken.current++; setState("idle"); setResponse(null); }
    else void read(imgs);
    return next;
  });
}
```
Keep `read()`, `verdict` useMemo, downloads, the verify form, and the lightbox unchanged (they consume `orderedImages`/`response`). Update `exportBase` to `orderedImages[0]?.file.name`.
- [ ] **Step 2: JSX — two slots.** Replace the `DropZone` + `images.length > 0` `<ul>` block with two labeled slots. A filled slot shows the clickable thumbnail (opens lightbox) + remove; an empty slot shows a `DropZone` with `multiple={false}`:
```tsx
{(["front", "back"] as const).map((key) => {
  const img = slots[key];
  const label = key === "front" ? "Front label" : "Back label";
  const required = key === "front";
  return (
    <div key={key}>
      <span className="mb-1.5 block font-medium text-ink">
        {label} <span className="font-normal text-ink-muted">{required ? "(required)" : "(optional)"}</span>
      </span>
      {img ? (
        <div className="flex items-center gap-3 rounded-card border border-border bg-surface-muted p-3">
          <button type="button" onClick={() => setZoom({ src: img.preview, alt: `${label} — ${img.file.name}` })}
            aria-label={`Enlarge ${img.file.name}`}
            className="group relative h-28 w-28 shrink-0 cursor-zoom-in overflow-hidden rounded border border-border bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
            <img src={img.preview} alt="" className="h-full w-full object-contain" />
            <span className="absolute bottom-1 right-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-base text-white"><IconZoom /></span>
          </button>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{img.file.name}</span>
          <button type="button" onClick={() => clearSlot(key)}
            className="min-h-[44px] rounded-field border-2 border-border-strong px-3 text-sm font-semibold text-ink transition hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2">
            Remove
          </button>
        </div>
      ) : (
        <DropZone id={`${ids.image}-${key}`} multiple={false}
          onFiles={(files) => files[0] && setSlot(key, files[0])}
          describedById={ids.imageHelp} />
      )}
    </div>
  );
})}
```
Wrap the two slots in `<div className="mt-6 grid gap-4 sm:grid-cols-2">` under the existing "1. Label images" heading; update the help text to "Drop the front label (and optionally the back). Click a thumbnail to enlarge."
- [ ] **Step 3: Remove dead bits.** Delete `guessPosition`, the `POSITIONS` constant if now unused, and the old `addFiles`/`setPosition`/`removeImage`/`images` references. `npm run typecheck; echo "tc:$?"` — fix any leftover references.
- [ ] **Step 4: Update component tests.** In `VerifyForm.test.tsx`, `dropLabelImage(container)` must target the FRONT slot's input. Since both slots render an input only when empty, the front input exists initially. Change the query to the first file input within the container (front slot):
```tsx
function dropFront(root: HTMLElement): void {
  const input = root.querySelector('input[type="file"]') as HTMLInputElement; // front slot (first, empty)
  fireEvent.change(input, { target: { files: [new File(["x"], "old-tom.png", { type: "image/png" })] } });
}
```
Replace `dropLabelImage(container)` calls with `dropFront(container)`. The verdict/extraction/re-upload assertions are unchanged. Add one test:
```tsx
it("shows explicit Front (required) and Back (optional) slots", () => {
  const q = within(render(<VerifyForm />).container);
  expect(q.getByText(/Front label/i)).toBeTruthy();
  expect(q.getByText(/Back label/i)).toBeTruthy();
});
```
- [ ] **Step 5: Gate + commit.** `npm run typecheck; echo $?` → 0; `npm run lint; echo $?` → 0; `npx vitest run src/app/VerifyForm.test.tsx; echo $?` → 0 (run a few times — the async tests carry retry). Commit: `feat(ui): explicit Front/Back upload slots (no position guessing)`.

---

## Phase 2 — Feature B: Batch verify-against-application

### Task 2: Pure claimed-row matcher
**Files:**
- Create: `src/batch/claimedMatch.ts`
- Create: `src/batch/claimedMatch.test.ts`

- [ ] **Step 1: Write the failing test:**
```ts
import { describe, it, expect } from "vitest";
import { resolveClaimedFor } from "./claimedMatch";
import type { ProductGroup } from "./pairing";
import type { ClaimedRow } from "./csv";

const map = new Map<string, ClaimedRow>([
  ["acme-front.jpg", { filename: "acme-front.jpg", brand: "Acme" }],
  ["old-tom", { filename: "old-tom", brand: "Old Tom" }],
]);
const group = (product: string, files: string[]): ProductGroup => ({
  product, images: files.map((f) => ({ filename: f, position: "front" as const })),
});

describe("resolveClaimedFor", () => {
  it("matches by an image filename", () => {
    expect(resolveClaimedFor(group("acme", ["acme-front.jpg", "acme-back.jpg"]), map)?.brand).toBe("Acme");
  });
  it("matches by the product stem (case-insensitive) when no filename matches", () => {
    expect(resolveClaimedFor(group("Old-Tom", ["Old-Tom.png"]), map)?.brand).toBe("Old Tom");
  });
  it("returns undefined when nothing matches", () => {
    expect(resolveClaimedFor(group("zzz", ["zzz.png"]), map)).toBeUndefined();
  });
});
```
- [ ] **Step 2:** `npx vitest run src/batch/claimedMatch.test.ts; echo $?` → expect FAIL (module missing).
- [ ] **Step 3: Implement:**
```ts
/**
 * claimedMatch.ts — resolve the application's claimed values for a batch product. Tries each of the
 * product's image filenames, then the product stem, all case-insensitively, against the claimed map.
 */
import type { ProductGroup } from "./pairing";
import type { ClaimedRow } from "./csv";

export function resolveClaimedFor(
  group: ProductGroup,
  claimed: Map<string, ClaimedRow>,
): ClaimedRow | undefined {
  const lower = new Map<string, ClaimedRow>();
  for (const [k, v] of claimed) lower.set(k.toLowerCase(), v);
  for (const img of group.images) {
    const hit = lower.get(img.filename.toLowerCase());
    if (hit) return hit;
  }
  return lower.get(group.product.toLowerCase());
}
```
- [ ] **Step 4:** `npx vitest run src/batch/claimedMatch.test.ts; echo $?` → 0.
- [ ] **Step 5: Commit:** `feat(batch): pure claimed-row matcher (filename or product stem)`.

### Task 3: Wire claimed CSV + verdict into BatchVerify
**Files:**
- Modify: `src/app/batch/BatchVerify.tsx`
- Modify: `src/app/batch/BatchVerify.test.tsx` (create if absent)
- Reference: `src/batch/csv.ts` (`parseClaimedCsv`, `analysisToCsv`, `ClaimedRow`), `src/compare` (`verifyLabel`)

- [ ] **Step 1: Imports + state.** Add:
```tsx
import { analysisToCsv, parseClaimedCsv, type ClaimedRow } from "@/batch/csv";
import { resolveClaimedFor } from "@/batch/claimedMatch";
import { verifyLabel, type VerifyResult } from "@/compare";
import { StatusBadge } from "../ui/StatusBadge";
import { toneForStatus } from "../ui/status";
```
Add `const [claimed, setClaimed] = useState<Map<string, ClaimedRow>>(new Map());` and add `result?: VerifyResult | null` to `BatchRow`.
- [ ] **Step 2: Parse the claimed CSV.** Add a labeled file input near the image dropzone:
```tsx
<div>
  <span className="mb-1.5 block font-medium text-ink">
    Application values <span className="font-normal text-ink-muted">(optional CSV: filename,brand,alcohol,class)</span>
  </span>
  <input type="file" accept=".csv,text/csv" aria-label="Application values CSV"
    onChange={async (e) => { const f = e.target.files?.[0]; if (f) setClaimed(parseClaimedCsv(await f.text())); e.target.value = ""; }}
    className={inputClass} />
  <button type="button" className={`${secondaryButtonClass} mt-2`}
    onClick={() => downloadCsv("application-values-template.csv", "filename,brand,alcohol,class\nacme-front.jpg,Acme,40% Alc./Vol.,Vodka\n")}>
    Download CSV template
  </button>
  {claimed.size > 0 && <p className="mt-1.5 text-sm text-ink-muted">{claimed.size} application row(s) loaded.</p>}
</div>
```
(`inputClass` is already imported; re-add it to the import from `../ui/fieldStyles` since Task A's sibling import removed it elsewhere — confirm it's imported here.)
- [ ] **Step 3: Run verifyLabel per product.** In `analyzeProduct`, after a successful read, resolve the claimed row and compute the verdict. Change `analyzeProduct(group)` to also take the claimed map:
```tsx
async function analyzeProduct(group: ProductImages, claimedMap: Map<string, ClaimedRow>): Promise<BatchRow> {
  // ... existing fetch/extract ...
  const r = json as VerifyApiResponse;
  const claimedRow = resolveClaimedFor({ product: group.product, images: group.images }, claimedMap);
  const result = claimedRow && r.readable && claimedRow.brand
    ? verifyLabel(
        { brand: claimedRow.brand, alcoholContentText: claimedRow.alcoholContent, classType: claimedRow.classType },
        r.extracted,
      )
    : null;
  return { ...base, status: "done", extracted: r.extracted, completeness: r.completeness, result, note: r.readable ? undefined : r.message };
}
```
Pass `claimed` into the worker pool call: `analyzeProduct(groups[idx], claimed)`. Note `ProductImages.images` are `{file, position}` (no filename) — build the matcher group from `group.images.map((im) => ({ filename: im.file.name, position: im.position }))`.
- [ ] **Step 4: Verdict column.** Add `"Application match"` to `COLS` and a cell:
```tsx
<td className="px-3 py-2.5">
  {r.result ? <StatusBadge tone={toneForStatus(r.result.overall)} label={r.result.overall} />
    : <span className="text-ink-muted">{claimed.size > 0 ? "no application row" : "—"}</span>}
</td>
```
Pass `result: r.result` into the `analysisToCsv` rows in `exportCsv` so the export includes verdict columns.
- [ ] **Step 5: Test (jsdom).** Create `BatchVerify.test.tsx`: mock `fetch` to return a readable extraction; upload an image (`acme-front.png`) + a claimed CSV (`filename,brand,alcohol\nacme-front.png,Acme,40% Alc./Vol.`); click "Read all labels"; assert an Approve/Review/Reject badge appears. (Stub `imageDownscale` like `VerifyForm.test.tsx`; scope queries to the container.)
- [ ] **Step 6: Gate + commit.** `npm run typecheck; echo $?`; `npm run lint; echo $?`; `npx vitest run src/batch src/app/batch; echo $?` → all 0. Commit: `feat(batch): verify against an application-values CSV (Approve/Review/Reject per product)`.

---

## Phase 3 — Feature C: deep code review

### Task 4: Multi-agent review over the final tree
**Files:** none (review); fixes land as follow-up commits.
- [ ] **Step 1:** Confirm full gate green: `npm run typecheck && npm run lint && npx vitest run && npm run eval` (use `;echo $?` per command).
- [ ] **Step 2:** Run a fan-out review (correctness, security, dead code, consistency, test quality, accessibility) over the working tree; collect a prioritized findings list.
- [ ] **Step 3:** Fix high-confidence findings, each as its own commit; re-run the gate after each.
- [ ] **Step 4:** Summarize the report (what was found, what was fixed, what was deferred) for the user.

---

## Self-review (spec coverage)
- **A (front/back slots):** Task 1 (AC-A1/A2/A3). ✓
- **B (batch verify):** Task 2 (AC-B2), Task 3 (AC-B1/B3/B4). ✓ `parseClaimedCsv` becomes production-referenced in Task 3 (AC-B4). ✓
- **C (review):** Task 4. ✓
- **Type consistency:** `resolveClaimedFor(group, map)` signature defined in Task 2 and called in Task 3; `BatchRow.result?: VerifyResult | null`; `ClaimedRow` fields (`brand`/`alcoholContent`/`classType`) map to `ClaimedFields` (`brand`/`alcoholContentText`/`classType`) consistently. `slots.front/back` + `orderedImages` used consistently in Task 1.
