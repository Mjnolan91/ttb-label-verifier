# Design Spec — Front/Back Upload Slots + Batch Verify-Against-Application

- **Date:** 2026-06-08
- **Status:** Approved (design); proceeding to plan + implementation
- **Scope:** Two focused features + a deep code review, on branch `feat/batch-verify-and-upload-slots`.

---

## 1. Context

Follow-up to the verify-first pass. Two user-driven improvements plus a code-quality review:

- **A — Front/back/both is implicit and guessed.** The single screen (`src/app/VerifyForm.tsx`) takes any
  number of images into one dropzone, auto-guesses each image's position by upload order
  (`guessPosition`), and exposes a per-image `front/back/neck/other` dropdown. The user wants to
  *explicitly* say what they're uploading (front, back, or both).
- **B — Batch has no verification.** `/batch` (`src/app/batch/BatchVerify.tsx`) does extraction +
  completeness only. The mechanism for batch verification already exists but is **dead code**:
  `parseClaimedCsv` (`src/batch/csv.ts:74`, filename → claimed brand/ABV/class) and the verdict
  columns in `analysisToCsv` are only referenced by tests. The brief's batch scenario (Sarah:
  200–300 labels at peak) wants the three-check verdict per label.
- **C — "Is it Fortune-50 clean?"** Run a deep multi-agent review over the final tree.

**Matching recap (no change needed, documented for clarity):** single screen fuses all uploaded
images of one product via `mergeExtracted`; batch groups by filename convention via
`src/batch/pairing.ts` (`acme-front.jpg` + `acme-back.jpg` → product "acme").

**Invariants preserved:** ~5 s latency, offline mock default, accessibility for a 70+ agent, no PII,
the pure deterministic comparator/domain. `typecheck · lint · test · eval` stay green.

---

## 2. Feature A — Two labeled drop slots (single screen)

Replace the single dropzone + `guessPosition` + per-image position dropdown with **two labeled drop
targets**: **"Front label" (required)** and **"Back label" (optional)**. Position is fixed by the slot.

- Each slot holds exactly one image; dropping into a filled slot replaces it. Each shows its
  clickable thumbnail (opens `ImageLightbox`) + a remove (×).
- State: replace `images: LabelImage[]` with `front?: LabelImage` / `back?: LabelImage`; on any change
  rebuild the ordered image list `[front, back].filter(Boolean)` and call `read()` (auto-read stays).
- Remove `guessPosition` and the per-image `<select>`. The merge/extraction/verdict pipeline is
  unchanged (front+back still fuse into one product).
- **Scope:** `neck`/`other` are dropped from the *single* screen (batch + the pipeline/types still
  support them). `LabelPosition` type is unchanged.

**Acceptance criteria**
- **AC-A1** The screen shows a "Front label" target and a "Back label (optional)" target; no
  position dropdown and no `guessPosition` remain.
- **AC-A2** Dropping a front image auto-reads; adding a back image re-reads the fused pair; the
  Approve/Review/Reject verdict still computes from the merged extraction.
- **AC-A3** Each slot's thumbnail opens the lightbox; removing a slot clears it (and re-reads or
  resets if both empty); object URLs are revoked on replace/remove.

## 3. Feature B — Batch verify-against-application (CSV)

Add an optional **"Application values (CSV)"** upload to `/batch`. Wire the existing
`parseClaimedCsv` + `verifyLabel` + `analysisToCsv` verdict columns.

- **CSV shape:** header `filename,brand,alcohol,class` (tolerant aliases already in `parseClaimedCsv`:
  `alcoholContent`, `classType`/`type`, `netContents`). A **"Download CSV template"** link emits a
  header + one example row.
- **Matching (new pure helper, `src/batch/claimedMatch.ts`):** `resolveClaimedFor(group, claimedMap)`
  returns the `ClaimedRow` for a product by trying, in order, each of the product's image filenames,
  then the product stem (case-insensitively). Returns `undefined` if none match.
- **Verification:** for each product that resolves a claimed row **with a brand**, map the row to
  `ClaimedFields` (`brand`, `alcoholContentText` ← `alcoholContent`, `classType`) and run
  `verifyLabel(claimed, extracted)`; store the `VerifyResult` on the `BatchRow`. Rows with no claimed
  match stay extraction-only.
- **UI:** a new **"Application match"** column shows a `StatusBadge` (Approve/Needs review/Reject)
  when a result exists, else "—" (or "no application row"). The existing **Download CSV** already
  appends `brand_status/alcohol_status/warning_status/overall` when any row has a result.
- This makes `parseClaimedCsv` and the verdict-column path **live**, removing the dead-code smell.

**Acceptance criteria**
- **AC-B1** Uploading images + a claimed CSV yields an Approve/Review/Reject badge per matched
  product; unmatched products remain extraction-only with no fabricated verdict.
- **AC-B2** `resolveClaimedFor` matches by image filename or product stem (case-insensitive),
  unit-tested incl. the no-match case.
- **AC-B3** The downloaded results CSV contains the verdict columns when a claimed CSV was supplied;
  a template is downloadable.
- **AC-B4** `parseClaimedCsv` is referenced by production code (no longer test-only).

## 4. Feature C — Deep code-quality review

After A+B land green, run a fan-out multi-agent review (correctness, security, dead code,
consistency, test quality, accessibility) over the final tree; produce a prioritized findings report
and fix the high-confidence items. (Read-only review; fixes land as their own commits.)

---

## 5. Testing strategy
- **A:** update `VerifyForm.test.tsx` for the two-slot layout (drop into the front slot to read; verify
  the verdict still appears); the async-integration tests keep their bounded retry.
- **B:** unit-test `resolveClaimedFor` (filename match, stem match, no match, case-insensitivity); a
  `BatchVerify` jsdom test that a claimed CSV produces a verdict badge.
- All gates green; `eval` unaffected (no comparator/domain change).

## 6. Risks & mitigations
- **A changes the upload data model** → keep the change contained to `VerifyForm` state + JSX; the
  `/api/verify` contract (multipart `image` + `position`) is unchanged.
- **B filename matching ambiguity** → the resolver tries image filenames then stem; documented in the
  CSV template; unmatched → extraction-only (never a fabricated verdict, per minimize-false-approvals).
- **Batch CSV parsing of user files** → `parseClaimedCsv` already handles quoting/headers and is
  unit-tested; malformed rows without a filename are skipped.
