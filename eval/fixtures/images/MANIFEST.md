# Fixture Image MANIFEST — TTB Label Verifier

This manifest is the contract between the hermetic test fixtures and the real label images a
human supplies later. Every `imageFilename` in [`../cases.json`](../cases.json) maps to exactly
one file in this directory. Rows #1–#7 are lightweight **`.svg` PLACEHOLDERS** that depict the
intended label so the suite is fully self-contained and needs no real image bytes; **row #8 is a
real supplied image** (the ABC clean-pass demo case); **rows #9–#11 are REAL generated raster
labels** (`.png`) wired to the demo's sample buttons, so the live Azure-vision demo extracts genuine
pixels — regenerate them with `node scripts/generate-demo-labels.cjs`. When a story needs a real
raster image (the real `llm` / `ocr` provider, or a live demo), drop the real file in at the exact
path below.

> **Dual role of these files.** The offline mock keys off the *filename* (pixels irrelevant), so the
> suite stays hermetic; but on the deployed `llm` demo the *same files' bytes* are sent to Azure. The
> `.svg` stubs (#1–#7) literally say "PLACEHOLDER" and aren't valid raster input for a vision model,
> which is why the demo sample buttons point at the real `.png` rows #9–#11 (+ the real `.jpg` #8),
> whose authored text matches their `extracted` block so the offline verdict equals a correct read.

## How the keying works (why these can be placeholders)
The mock `VisionProvider` keys off the **filename**, not the pixels: given `imageFilename` it
returns the `extracted` block from `cases.json` for that case. So the unit tests, the
`/api/verify` integration test, and `npm run eval` all run offline with no real images and no
network. The placeholders exist only to (a) be human-viewable documentation of each scenario and
(b) hold the exact path a real image must occupy. See [`../README.md`](../README.md) for the full
hermetic-keying explanation.

## Image table

| # | imageFilename | Exact path (from repo root) | Case id in cases.json | Required look / dimensions | What the label MUST depict | Expected overall |
|---|---|---|---|---|---|---|
| 1 | `old-tom-bourbon-clean.svg` | `eval/fixtures/images/old-tom-bourbon-clean.svg` | `clean-pass` | Portrait label, ~600x800 (2:3 ratio min; legible at 100%); flat, well-lit, no glare/skew | Brand **OLD TOM DISTILLERY**; class/type "Kentucky Straight Bourbon Whiskey"; **45% Alc./Vol. (90 Proof)**; net **750 mL**; the FULL canonical government warning with the **`GOVERNMENT WARNING:`** prefix in ALL-CAPS and **bold**, remainder regular weight. Everything correct. | **approve** |
| 2 | `warning-title-case.svg` | `eval/fixtures/images/warning-title-case.svg` | `warning-title-case-fail` | Same as #1 | Identical to #1 EXCEPT the warning prefix is rendered title-case **`Government Warning:`** instead of all-caps. Warning body wording is otherwise verbatim. This is the only defect. | **reject** |
| 3 | `abv-out-of-tolerance.svg` | `eval/fixtures/images/abv-out-of-tolerance.svg` | `alcohol-out-of-tolerance-fail` | Same as #1 | Identical to #1 EXCEPT the alcohol statement reads **46% Alc./Vol. (92 Proof)** while the application claims 45%. 1.0 pp over the +/-0.3 pp distilled-spirits tolerance. Warning is correct/complete. | **reject** |
| 4 | `stones-throw-smartquote.svg` | `eval/fixtures/images/stones-throw-smartquote.svg` | `brand-smartquote-normalizes-pass` | Portrait label, ~600x800; clean | Brand printed **`STONE’S THROW`** (ALL-CAPS, curly apostrophe U+2019) while the application claims `Stone’s Throw`. Differs ONLY by case + smart quote. **40% Alc./Vol. (80 Proof)**, **750 mL**, full canonical warning, all-caps bold prefix. Benign — must PASS after normalization. | **approve** |
| 5 | `brand-typo-review.svg` | `eval/fixtures/images/brand-typo-review.svg` | `brand-typo-review` | Same as #1 | Brand printed **`Old Tomm Distillery`** (one extra "m") while the application claims `Old Tom Distillery`. A genuine near-miss typo (single-character edit). Alcohol and warning are correct. Should land in REVIEW, not pass and not fail. | **review** |
| 6 | `warning-missing.svg` | `eval/fixtures/images/warning-missing.svg` | `warning-missing-fail` | Same as #1 | Brand/class/alcohol/net all correct, but the government health warning block is **entirely absent** from the label. Product is 45% ABV (well above 0.5%), so the warning is mandatory. | **reject** |
| 7 | `unreadable-blurry.svg` | `eval/fixtures/images/unreadable-blurry.svg` | `unreadable-low-confidence-review` | Portrait label, ~600x800, deliberately **illegible** (heavy blur + glare wash) so no field can be read | A label photo so blurry/glare-washed/skewed that **none** of the fields are legible. The point is the unreadable *capture*, not any specific text. Drives the low-confidence "re-upload a clearer photo" path; must never auto-approve. | **review** |
| 8 | `abc-single-barrel-clean.jpg` | `eval/fixtures/images/abc-single-barrel-clean.jpg` | `abc-rye-clean-real-image` | **REAL IMAGE — already supplied** (front+back artwork, flat) | Brand **ABC** (ABC Distillery, "Single Barrel"); class/type "Straight Rye Whisky"; **45% ALC/VOL** (no proof printed — proof is optional); net **750 mL**; the full canonical government warning with an ALL-CAPS **bold** `GOVERNMENT WARNING:` prefix. Everything correct. | **approve** |
| 9 | `demo-old-tom-clean.png` | `eval/fixtures/images/demo-old-tom-clean.png` | `demo-clean-approve` | **REAL generated raster** (720×820), wired to a demo sample button | Brand **OLD TOM DISTILLERY**; "Kentucky Straight Bourbon Whiskey"; **45% Alc./Vol. (90 Proof)**; **750 mL**; full canonical warning, ALL-CAPS **bold** `GOVERNMENT WARNING:` prefix. Everything correct. | **approve** |
| 10 | `demo-warning-title-case.png` | `eval/fixtures/images/demo-warning-title-case.png` | `demo-warning-title-case-reject` | **REAL generated raster** (720×820), demo sample button | Identical to #9 EXCEPT the warning prefix is rendered title-case **`Government Warning:`**. Sole defect. | **reject** |
| 11 | `demo-brand-typo.png` | `eval/fixtures/images/demo-brand-typo.png` | `demo-brand-typo-review` | **REAL generated raster** (720×820), demo sample button | Brand printed **`Old Tomm Distillery`** (one extra "m") vs claimed `Old Tom Distillery`. Sole near-miss; alcohol and warning correct. | **review** |

> Dimensions note: ~600x800 is a guideline that matches the placeholder canvas. Real photos may be
> larger or a different aspect ratio — that is fine. What matters is that the label is legible and
> depicts exactly the content in the "What the label MUST depict" column, because a human will read
> these to confirm the fixture verdicts are fair. The mock provider never reads the pixels.

---

## ACTION REQUIRED: replace these placeholders with real images at these exact paths

Rows **#1–#7** above are **`.svg` placeholders**, not real label photographs (row **#8** is already
a real supplied image — the ABC clean-pass demo case). The hermetic suite
(unit tests, the `/api/verify` integration test, and `npm run eval`) passes WITHOUT real images
because the mock provider keys off the filename. **But** the moment a story exercises a real
extraction provider (`VISION_PROVIDER=llm` or `ocr`) or a live demo/screenshot is needed, real
images must exist at these exact paths.

To supply them:

1. Generate or photograph the label images that depict **exactly** what each row's "What the label
   MUST depict" column describes — one clean, the five deliberate defects, and one deliberately
   unreadable (blurry/glare) capture. An AI image tool is fine (per `specs/PROJECT_SPEC.md` ->
   "Test labels").
2. Save each real image at the **exact path** in the table's "Exact path" column. If you supply a
   raster format (e.g. `.png`/`.jpg`) instead of `.svg`, update the matching `imageFilename` values
   in [`../cases.json`](../cases.json) AND the paths here so the filenames stay in lockstep — the
   filename is the only key the mock uses, so a name mismatch silently breaks the mapping.
3. Keep the defects faithful: the title-case prefix, the 46%/92-proof ABV, the curly-apostrophe
   `STONE’S THROW`, the `Old Tomm` typo, and the missing warning are the whole point — they prove
   the checks catch failures, not just clean inputs.
4. Re-run `npm test` and `npm run eval` and confirm the expected verdicts in `cases.json` still
   hold. The expected verdicts are CFR-grounded and should not change when real images replace the
   placeholders; if a real image cannot reproduce a defect cleanly, fix the image, not the verdict.

Until real images are dropped in, the placeholders are sufficient for the entire offline test and
eval suite.
