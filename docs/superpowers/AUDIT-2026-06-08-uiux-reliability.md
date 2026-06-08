# Audit — UI/UX reliability & spec-implementation gap (2026-06-08)

> **Update (2026-06-08, same day):** the "quick reliability/UX wins" pass landed. **Fixed:** verdict
> `aria-live` announcement (High a11y); batch JSON export now carries the verdict (High consistency);
> batch matched-but-unreadable now says "re-scan" instead of "no application row" + no longer misfires
> the "none matched" banner; completeness section gained a plain next-step line; per-field cards now
> read Match / Needs review / No match (not PASS/REVIEW/FAIL); batch screen shows the demo-mode hint;
> the four disclosure toggles are now ≥44px; `/api/verify` enforces the body-size cap *before*
> buffering (streaming guard). Tests 278→288 (+10), all gates green. **Still open:** Feature A Part 2,
> Feature B, and the Low/polish list below.


**Method:** 7-dimension multi-agent audit (feature-gap, reliability/state, error/edge paths,
accessibility, UX clarity, cross-surface consistency, security/data). Every finding was
**adversarially verified** against the cited code by a second agent instructed to refute it.
28 findings raised, 0 fully refuted, several severity-corrected down by the verifier (recorded
below as the calibrated severity). Baseline gates all green at audit time: `typecheck · lint ·
test (278) · eval (100%, approve-precision 100%) · build`.

## What is solid (verified, not assumed)
- **No false-approval path exists.** `combinedVerdict` (`src/compare/reviewVerdict.ts:51`) takes the
  worse of the 3-check comparison and the per-type completeness gate; an `incomplete` label resolves
  to `review`, never `approve`. The brief's core safety guarantee ships and works.
- **The verdict is deterministic / rules-based** — no model decides pass/fail (AC-3 met).
- **CSV injection is genuinely defanged** — the security pass found no formula-injection hole in
  `src/batch/csv.ts`; the only data finding was the request-body buffering cap (#28 below).
- **Eval gate intact** — approve-precision floor (0.98) satisfied under the gated verdict (AC-4 met).

## The headline gap: two designed features are unbuilt
The approved spec (`docs/superpowers/specs/2026-06-08-completeness-gated-approval-and-review-worklist-design.md`)
was deliberately phased; only **Plan 1 (completeness-gated verdict)** shipped. Of its 12 acceptance
criteria: **3 met, 1 partial (AC-1), 8 unmet.**

| Feature | State | Evidence |
|---|---|---|
| **A Part 1 — completeness-gated verdict** | ✅ Built, wired into single screen + batch + CSV | `reviewVerdict.ts`, eval fixture `old-tom-no-net-contents` |
| **A Part 2 — confirm-to-approve UX (ConfirmFields)** | ❌ Unbuilt | No `ConfirmFields`/`ConfirmableField` in `src/`; `VerifyForm.tsx:298` still the 3-input form; no per-field hoisting, no Tab-accept, no Approve-gating control. Plan 2 never written. |
| **A — per-field `reviewVerdict(ConfirmableField[])` model** | ❌ Unbuilt | Shipped `combinedVerdict(claimed, extracted)` is a 2-input combiner; AC-1's "high-confidence missing mandatory → **reject**" clause is **unmet** (maps to `review`, `reviewVerdict.ts:28-32`). |
| **B — review worklist** | ❌ Unbuilt | No `useWorklist`/`Worklist`/`localStorage` anywhere in `src/`. AC-B1..B4 all unsatisfiable. |

These are documented-as-deferred (not silent omissions), but they are the substance of "I don't
think we've implemented everything yet."

## Reliability & UX findings (calibrated severity)

### High
- **Verdict appears with no announcement on the upload-then-type flow** (`a11y`) —
  `ResultView` has no `aria-live`; focus-to-verdict only fires on explicit Verify-button submit
  (`VerifyForm.tsx:104-109`). A screen-reader/keyboard agent who uploads first, then types the
  application values (the promoted flow) gets the Approve/Reject verdict with **zero** announcement.
  WCAG 4.1.3 gap on the screen's core output. → wrap an `aria-live="polite"`/`role="status"` around
  the verdict banner. `src/app/ResultView.tsx:76-83`, `src/app/VerifyForm.tsx:78-83`.
- **Batch JSON export silently drops the Approve/Review/Reject verdict** (`consistency`) —
  batch CSV and single-screen JSON both carry it; batch JSON emits only `{product, extracted,
  completeness}` though `r.result`/`r.overall` are on the row. Exports of the same product disagree.
  `src/app/batch/BatchVerify.tsx:173-182`.

### Medium
- **Batch: a matched-but-unreadable product shows "no application row" and can corrupt the "none
  matched" banner** (`bug`) — sends the agent to fix a CSV filename mapping that is actually correct.
  `src/app/batch/BatchVerify.tsx:86-91,171-172,367-372`.
- **Per-field cards show raw `PASS/REVIEW/FAIL`** while the headline says `Approve/Needs review/
  Reject` on the same screen (`consistency`) — forces the user to mentally map FAIL=Reject.
  `src/app/ResultView.tsx:42`.
- **Completeness section has no "what do I do now" line** (`ux`) — yet it is the **headline** result
  when no application values are entered (the most common demo path). `src/app/ui/CompletenessView.tsx:50-58`.
- **`unverifiable` is labelled "NOT APPLICABLE"** even for conditional items (sulfites, country of
  origin, appellation) that actually need a human look (`ux`). `src/app/ui/CompletenessView.tsx:19-24`.
- **Batch screen omits the demo-mode hint** (`consistency`) — a reviewer testing `/batch` with real
  photos in mock mode sees every row fail unexplained. `src/app/batch/BatchVerify.tsx:200-208`.
- **Disclosure summaries ("Show everything", "Raw JSON", etc.) are ~20px tall** — below the 44px
  target the rest of the UI enforces (`a11y`). `src/app/ui/ExtractedFieldsView.tsx:98,114`.
- **`/api/verify` buffers the whole multipart body before the size cap** (`reliability`) — the
  pre-buffer Content-Length guard is client-bypassable (omit/garble the header); `request.formData()`
  then allocates the full body. Memory-exhaustion DoS on a no-auth endpoint; the "enforced
  server-side" comment overstates. `src/app/api/verify/route.ts:42-93`.

### Low (polish / hardening)
- Object-URL previews never revoked on unmount → bounded memory leak, worst on the batch "upload
  many" path. `VerifyForm.tsx:164`, `BatchVerify.tsx:126`.
- Batch edit controls (Remove/drop) not disabled mid-run → transient thumbnail/summary desync
  (verifier **refuted** the wrong-verdict-on-wrong-product claim). `BatchVerify.tsx:242`.
- No `AbortController` on client fetches → superseded reads run to completion (a monotonic
  `readToken` keeps state correct; just wasted upload/quota). `VerifyForm.tsx:136`.
- `setSlot`/`clearSlot` run side effects inside the `setSlots` updater → dev/StrictMode double-fire.
- EXIF orientation baked only on the downscale path → already-small portrait photos can reach the
  model sideways. `imageDownscale.ts:47-57`.
- No client-side file type/size pre-check → wrong-type/oversized files fully upload before the server
  413/415 (message is correct, just a wasted round-trip).
- Batch application-CSV slot accepts any file → silent zero rows with no "0 loaded" feedback.
- Disabled Verify button is non-focusable and its reason isn't `aria-describedby`-linked.
- Result-section headings are `<h2>` siblings of the form's `<h2>` → flattened heading outline.
- Loading→result focus jump can relocate focus mid-task; verdict text sits outside the focused heading.
- Completeness detail lines leak raw CFR citations / `Found (low confidence — verify): "..."` quoting.
- No idle empty-state cue anchoring where the result will appear.
- `(conditional)` chip is unexplained jargon (no tooltip).
- Single-screen JSON exports the **ungated** `result.overall` while the CSV exports the gated
  `overall` → machine consumers can read `approve` for a label shown as `Needs review`.
- Batch gated verdict carries no "gated by completeness" explanation (single screen does).

## Recommended sequencing
1. **Decide scope first:** build the missing Feature A Part 2 + Feature B, or formally de-scope them
   in the spec and submit Plan 1 as the deliverable. Annotate AC status either way.
2. **Quick reliability/UX wins (small, high-value):** verdict `aria-live` (High a11y), batch JSON
   verdict (High consistency), batch unreadable-but-matched messaging, completeness next-step line,
   PASS/FAIL→plain labels, batch demo hint, 44px summaries, body-size cap. Each is a localized edit.
3. **Polish pass:** the Low list, ideally batched into one cleanup commit.
