# Fixture Image MANIFEST — TTB Label Verifier

This manifest is the contract between the hermetic test fixtures and any real label images supplied
later. Nearly every `imageFilename` in [`../cases.json`](../cases.json) maps to exactly one file in
this directory (four later-added cases — `granite-peak-ipa-fuzzy.svg`, `cayo-verde-superior-rum.svg`,
`northgate-acronym-vodka.svg`, `cayo-verde-spiced-specialty.svg` — still need a placeholder file +
row here; the offline suite passes without them because the mock keys off the filename string, never
the bytes). Rows #1–#7 and #12–#16 are lightweight **`.svg` PLACEHOLDERS** that depict the
intended label so the suite is fully self-contained and needs no real image bytes; **row #8 is a real
supplied image** (the ABC clean-pass demo case); **rows #9–#11 are REAL generated raster labels**
(`.png`; regenerate with `node scripts/generate-demo-labels.cjs` — eval fixtures only since
2026-06-11); **rows #17–#19 are the Fear the Dragon demo pair + its edited defect variant**
(real artwork `.jpg`, built by `node scripts/make-fear-the-dragon-demo.cjs` and byte-mirrored into
`public/samples/` for the README's "Try it in two minutes" walkthrough), so the live vision demo
extracts genuine pixels. To exercise a real provider
(`openai` / `gemini` / `llm` / `ocr`) on the placeholder scenarios, drop a real raster at the exact
path below.

> **Dual role of these files.** The offline mock keys off the *filename* (pixels irrelevant), so the
> suite stays hermetic; but on a deployed real-provider demo (OpenAI on the live URL; Azure OpenAI
> for the in-tenant target) the *same files' bytes* are sent to the model. The
> `.svg` stubs (#1–#7) literally say "PLACEHOLDER" and aren't valid raster input for a vision model,
> which is why the README's demo walkthrough points at the real `.png` rows #9–#11 (+ the real `.jpg` #8),
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
| 9 | `demo-old-tom-clean.png` | `eval/fixtures/images/demo-old-tom-clean.png` | `demo-clean-approve` | **REAL generated raster** (720×820), linked from the README walkthrough | Brand **OLD TOM DISTILLERY**; "Kentucky Straight Bourbon Whiskey"; **45% Alc./Vol. (90 Proof)**; **750 mL**; full canonical warning, ALL-CAPS **bold** `GOVERNMENT WARNING:` prefix. Everything correct. | **approve** |
| 10 | `demo-warning-title-case.png` | `eval/fixtures/images/demo-warning-title-case.png` | `demo-warning-title-case-reject` | **REAL generated raster** (720×820), README walkthrough | Identical to #9 EXCEPT the warning prefix is rendered title-case **`Government Warning:`**. Sole defect. | **reject** |
| 11 | `demo-brand-typo.png` | `eval/fixtures/images/demo-brand-typo.png` | `demo-brand-typo-review` | **REAL generated raster** (720×820), README walkthrough | Brand printed **`Old Tomm Distillery`** (one extra "m") vs claimed `Old Tom Distillery`. Sole near-miss; alcohol and warning correct. | **review** |
| 12 | `marisol-table-wine-clean.svg` | `eval/fixtures/images/marisol-table-wine-clean.svg` | `wine-under14-approve` | Portrait label, ~600x800; clean | Brand **MARISOL**; class/type **Table Wine** (Sonoma County); **13.5% Alc./Vol.**; net **750 mL**; "Contains Sulfites"; full canonical warning, ALL-CAPS **bold** `GOVERNMENT WARNING:` prefix. Application claims 12.5% — a 1.0 pp gap that is inside the wine ≤14% +/-1.5 pp band but outside the spirits band. | **approve** |
| 13 | `oakmoor-port-over14-boundary.svg` | `eval/fixtures/images/oakmoor-port-over14-boundary.svg` | `wine-over14-boundary-reject` | Same as #12 | Brand **OAKMOOR**; class/type **Tawny Port** (Napa Valley, a >14% wine); label reads **14.0% Alc./Vol.** while the application claims 14.5%; net **750 mL**; full canonical warning, all-caps bold prefix. The 0.5 pp gap is inside the +/-1.0 pp band, but 14.0% crosses the 14% tax-class boundary (27 CFR 4.36(c)) — the sole defect. | **reject** |
| 14 | `granite-peak-ipa-clean.svg` | `eval/fixtures/images/granite-peak-ipa-clean.svg` | `malt-beverage-approve` | Portrait label, ~600x800; clean | Brand **GRANITE PEAK**; class/type **India Pale Ale** (resolves to malt beverage); **6.7% Alc./Vol.**; net **12 FL OZ**; full canonical warning, ALL-CAPS **bold** `GOVERNMENT WARNING:` prefix. Application claims 6.5% — a 0.2 pp gap inside the malt +/-0.3 pp band. | **approve** |
| 15 | `old-tom-no-net-contents.svg` | `eval/fixtures/images/old-tom-no-net-contents.svg` | `missing-net-contents-review` | Portrait label, ~600x800 | Identical to #1 EXCEPT **net contents is omitted**. Brand/class/alcohol/warning all correct; the missing mandatory field is the sole defect. | **review** |
| 16 | `sangria-import-no-country.svg` | `eval/fixtures/images/sangria-import-no-country.svg` | `sangria-import-no-country-review` | Portrait label, ~600x800; clean | Brand **Sailor Sally's** (Sailor Sally's Cellars, Valencia, Spain); class/type **Sangria**; **8.5% ALC/VOL (17 PROOF)**; net **750 mL**; importer line **"IMPORTED BY: SEA TRADER IMPORTS, MIAMI, FL."**; full canonical warning, ALL-CAPS **bold** prefix. NO "Product of Spain" statement anywhere — the import is inferred (importer line + foreign producer address) and the missing country-of-origin statement is the sole defect. | **review** |
| 17 | `fear-the-dragon-front.jpg` | `eval/fixtures/images/fear-the-dragon-front.jpg` | `fear-the-dragon-front-panel-alone` | **REAL artwork** (1200x1200, Dragon Distillery x Flying Dog), README walkthrough + `public/samples/` | Front panel of the demo PAIR: brand **Fear the Dragon**; "Spirit Distilled from Grain and Pumpkin"; statement of composition; **50% ALC./VOL. (100 PROOF)**; responsibility line "Distilled & Bottled by Dragon Distillery, LLC Frederick, MD". No net contents, no warning (both live on the back), so ALONE it must never approve; the walkthrough uploads front+back together for the joint-read approve. | **review** |
| 18 | `fear-the-dragon-back.jpg` | `eval/fixtures/images/fear-the-dragon-back.jpg` | `fear-the-dragon-back-panel-alone` | **REAL artwork** (900x1126), README walkthrough + `public/samples/` | Back panel of the demo pair: marketing text, **750ML**, and the full statutory warning printed ENTIRELY in caps with a **bold** `GOVERNMENT WARNING:` prefix (the body's case folds; only the prefix carries the caps+bold rule). Alone it lacks class/alcohol/responsibility, so completeness routes it to review. | **review** |
| 19 | `fear-the-dragon-warning-not-bold-back.jpg` | `eval/fixtures/images/fear-the-dragon-warning-not-bold-back.jpg` | `fear-the-dragon-warning-not-bold-reject` | **EDITED TEST ARTIFACT** (built by `scripts/make-fear-the-dragon-demo.cjs`; the real label is compliant) | Identical to #18 EXCEPT the warning block is re-rendered with the `GOVERNMENT WARNING:` prefix in **regular weight** (still all caps, wording verbatim). The sole defect 27 CFR 16.22(a)(2) hard-fails on; the only fixture isolating the bold rule. | **reject** |
| 17 | `jolly-jerrys-region-origin.svg` | `eval/fixtures/images/jolly-jerrys-region-origin.svg` | `region-origin-not-country-review` | Portrait label, ~600x800; clean | Brand **JOLLY JERRY'S** (Jolly Jerry's Distillery, Bridgetown, Barbados); class/type **Rum**; **40% ALC/VOL (80 PROOF)**; net **750 mL**; origin line **"IMPORTED FROM THE CARIBBEAN"**; full canonical warning, ALL-CAPS **bold** prefix. The origin statement names a REGION, not a country — it matches the application verbatim, and the defect is the statement itself (CBP marking requires the country, e.g. "Product of Barbados"). | **review** |

> Dimensions note: ~600x800 is a guideline that matches the placeholder canvas. Real photos may be
> larger or a different aspect ratio — that is fine. What matters is that the label is legible and
> depicts exactly the content in the "What the label MUST depict" column, because a human will read
> these to confirm the fixture verdicts are fair. The mock provider never reads the pixels.

---

## Supplying real images (optional)

The `.svg` rows above (#1–#7) are **hermetic placeholders**: the mock provider keys off the
filename, so the entire offline suite (unit tests, the `/api/verify` integration test, and
`npm run eval`) passes without any real image bytes. Real rasters are needed only to exercise a live
extraction provider (`VISION_PROVIDER=openai`/`gemini`/`llm`/`ocr`) or to capture a demo screenshot — and even
then only for whichever scenario you want to run live (row #8 is already a real image, and the
README's demo walkthrough already points at the real `.png` rows #9–#11).

To drop in your own:

1. Generate or photograph a label that depicts **exactly** what the row's "What the label MUST
   depict" column describes — one clean, the deliberate defects, and one deliberately unreadable
   (blurry/glare) capture. An AI image tool is fine (per `specs/PROJECT_SPEC.md` → "Test labels").
2. Save it at the **exact path** in the table's "Exact path" column. If you use a raster format
   (e.g. `.png`/`.jpg`) instead of `.svg`, update the matching `imageFilename` in
   [`../cases.json`](../cases.json) AND the path here so the filenames stay in lockstep — the
   filename is the only key the mock uses, so a name mismatch silently breaks the mapping.
3. Keep the defects faithful: the title-case prefix, the 46%/92-proof ABV, the curly-apostrophe
   `STONE’S THROW`, the `Old Tomm` typo, and the missing warning are the whole point — they prove
   the checks catch failures, not just clean inputs.
4. Re-run `npm test` and `npm run eval` and confirm the expected verdicts in `cases.json` still
   hold. The expected verdicts are CFR-grounded and should not change when real images replace the
   placeholders; if a real image cannot reproduce a defect cleanly, fix the image, not the verdict.

Until real images are dropped in, the placeholders are sufficient for the entire offline test and
eval suite.
