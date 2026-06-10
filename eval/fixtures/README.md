# eval/fixtures — hermetic labeled cases

This directory holds the **hermetic** test fixtures shared by three consumers:

1. the **mock `VisionProvider`** (the default extractor in dev and in every test),
2. the **`POST /api/verify` integration test**, and
3. the **`npm run eval`** precision/recall + latency harness.

"Hermetic" means: **the whole suite runs with no network, no API keys, and no real image bytes.**
That is a hard project invariant (see `AGENTS.md` -> "Offline by default").

## How the keying works — filename, not pixels

The mock provider keys off the **`imageFilename` string**, NOT the contents of the image. Given a
filename, it looks up the matching case in [`cases.json`](./cases.json) and returns that case's
`extracted` block (the fields a real model would have read off the label, each with a confidence,
plus the two warning-prefix format flags). Nothing ever decodes image bytes in the default/test
path.

```
imageFilename ──► mock VisionProvider ──► cases.json[*].extracted ──► reconciler ──► comparator ──► verdict
   (the key)        (no pixels read)        (the canned reading)        (pure, deterministic)
```

Because the key is the filename, the files under [`images/`](./images) can be lightweight `.svg`
**placeholders** and the tests still exercise the full extract -> compare -> verdict pipeline. The
placeholders are human-viewable documentation of each scenario; they are not consumed as pixels.

## What's in here

| File | Purpose |
|---|---|
| [`cases.json`](./cases.json) | The labeled cases: each has `claimed` (what the application asserts), `extracted` (what the mock returns for that image), and `expected` (the deterministic per-field + overall verdict). |
| [`images/MANIFEST.md`](./images/MANIFEST.md) | Maps each `imageFilename` to its exact path, required look/dimensions, and exactly what the label must depict — plus the "replace placeholders with real images" instructions. |
| [`images/*.svg`](./images) | One PLACEHOLDER stub per case, clearly marked, depicting that label. |

## The cases (and their expected OVERALL verdict)

| Case id | imageFilename | Brand | Alcohol | Warning | **Overall** |
|---|---|---|---|---|---|
| `clean-pass` | `old-tom-bourbon-clean.svg` | pass | pass | pass | **approve** |
| `warning-title-case-fail` | `warning-title-case.svg` | pass | pass | **fail** | **reject** |
| `alcohol-out-of-tolerance-fail` | `abv-out-of-tolerance.svg` | pass | **fail** | pass | **reject** |
| `brand-smartquote-normalizes-pass` | `stones-throw-smartquote.svg` | pass | pass | pass | **approve** |
| `brand-typo-review` | `brand-typo-review.svg` | **review** | pass | pass | **review** |
| `warning-missing-fail` | `warning-missing.svg` | pass | pass | **fail** | **reject** |
| `unreadable-low-confidence-review` | `unreadable-blurry.svg` | review | review | review | **review** |
| `abc-rye-clean-real-image` | `abc-single-barrel-clean.jpg` (real image) | pass | pass | pass | **approve** |
| `demo-clean-approve` | `demo-old-tom-clean.png` (real demo raster) | pass | pass | pass | **approve** |
| `demo-warning-title-case-reject` | `demo-warning-title-case.png` (real demo raster) | pass | pass | **fail** | **reject** |
| `demo-brand-typo-review` | `demo-brand-typo.png` (real demo raster) | **review** | pass | pass | **review** |
| `wine-under14-approve` | `marisol-table-wine-clean.svg` | pass | pass | pass | **approve** |
| `wine-over14-boundary-reject` | `oakmoor-port-over14-boundary.svg` | pass | **fail** | pass | **reject** |
| `malt-beverage-approve` | `granite-peak-ipa-clean.svg` | pass | pass | pass | **approve** |
| `malt-beverage-fuzzy-read-review` | `granite-peak-ipa-fuzzy.svg` | **review** | pass | pass | **review** |
| `missing-net-contents-review` | `old-tom-no-net-contents.svg` | pass | pass | pass | **review** |
| `puffery-excluded-rum-approve` | `cayo-verde-superior-rum.svg` | pass | pass | pass | **approve** |
| `producer-acronym-brand-approve` | `northgate-acronym-vodka.svg` | pass | pass | pass | **approve** |
| `specialty-spiced-rum-approve` | `cayo-verde-spiced-specialty.svg` | pass | pass | pass | **approve** |
| `sangria-import-no-country-review` | `sangria-import-no-country.svg` | pass | pass | pass | **review** |

The sangria case is the origin-inference fixture: every claimed-vs-label comparison passes, but the
label carries an importer line and a foreign producer address with NO "Product of Spain" statement,
so the inferred import's missing country of origin routes the overall verdict to review.
The `cayo-verde`/`northgate` trio are NEGATIVE-ALLOCATION fixtures — see "Per-field metrics and allocation fixtures" below.
(The Brand/Alcohol/Warning columns are the three CFR-core checks; the eval also scores four more
per-field metrics — `classType`, `netContents`, `fancifulName`, `statementOfComposition` — not shown
here to keep the table narrow. Each case's full per-field expectation lives in its `expected.perField`
in `cases.json`.)

### Verdict model (must match the comparator in `src/compare/`)
- Per-field status is one of `pass` | `review` | `fail`.
- **Overall** = `reject` if ANY field is `fail`; else `review` if ANY field is `review`; else
  `approve`. (Asymmetric by design — see `AGENTS.md` -> "Thresholds": minimize false approvals.)

### Why these specific verdicts (CFR-grounded)
- **Clean pass** — every field correct; 45% ABV with a self-consistent 90-proof cross-check
  (proof = 2 x ABV) is trivially inside the distilled-spirits **+/-0.3 pp** tolerance
  (27 CFR 5.65(c)).
- **Title-case warning -> fail** — the body is verbatim but the prefix is `Government Warning:`
  instead of the required ALL-CAPS `GOVERNMENT WARNING:` (27 CFR 16.22(a)(2)). The strict warning
  check fails it; it is never a review.
- **ABV out of tolerance -> fail** — claimed 45% vs label 46% = **1.0 pp**, which exceeds the
  spirits **+/-0.3 pp** tolerance, so 0.7 pp clear of the band: unambiguous fail, not a borderline
  review.
- **Smart-quote brand -> pass** — `Stone’s Throw` vs `STONE’S THROW` differ only by case and the
  curly apostrophe (U+2019). After normalize(case + whitespace + punctuation + smart quotes) they
  are identical. This MUST pass (the brief's tolerant-matching requirement); it must not be a
  review.
- **Brand typo -> review** — `Old Tom Distillery` vs `Old Tomm Distillery` is a real one-character
  edit that survives normalization, but the strings are highly similar, so it routes to review
  (surface the discrepancy to a human) rather than pass or fail.
- **Missing warning -> fail** — no warning at all on a 45% ABV product, which is far above the
  0.5% ABV threshold below which the warning is exempt (27 CFR 16.10 / 27 CFR Part 16). Mandatory
  and absent = hard fail.
- **Unreadable image -> review (re-upload)** — a blurry/glare-y photo where every field comes back
  empty at **low** confidence (~0.3) and the warning prefix bold-ness is undetectable
  (`warningPrefixIsBold: null`). The system cannot assert anything, so it routes to review and asks
  for a clearer photo instead of guessing. Contrast with *missing warning*, which is an empty
  warning at **high** confidence (a real violation -> fail). This is the path the asymmetric
  thresholds protect: never auto-approve what you could not read.
- **ABC rye (real image) -> approve** — the one real supplied label
  (`abc-single-barrel-clean.jpg`): brand ABC, **45% Alc./Vol. with no proof printed** (proof is
  optional — the comparator must not require the proof = 2x ABV cross-check when it is absent), and
  the canonical warning with a bold all-caps prefix. All fields pass -> approve. This is the label a
  reviewer can actually upload at the live demo (which runs a real provider) and see verified end to
  end; the same case also passes offline in mock mode (filename-keyed).
- **Wine ≤14% -> approve** — `Table Wine`, claimed 12.5% vs label 13.5% = **1.0 pp**. Outside the
  spirits **+/-0.3 pp** band but inside the wine ≤14% **+/-1.5 pp** band (27 CFR 4.36(b)(1)), so the
  verdict turns on the class selecting the right tolerance row. 13.5% stays under the 14% boundary,
  brand + canonical warning pass -> approve. Proves the +/-1.5 pp band is actually exercised — a
  spirits-only suite never reaches it.
- **Wine >14% (14% boundary) -> reject** — a `Tawny Port` claimed at 14.5% (so the **+/-1.0 pp**
  >14% band applies) but the label reads **14.0%**. Numerically |14.5 − 14.0| = 0.5 pp is *inside*
  the band, yet a wine stated over 14% may not ride the tolerance down across the 14% tax-class
  boundary (**27 CFR 4.36(c)**): actual 14.0% falls to/below 14% -> hard alcohol **fail** -> reject.
  This is the asymmetric boundary clamp the symmetric +/- value can't express.
- **Malt beverage -> approve** — `India Pale Ale` resolves to malt, selecting the **+/-0.3 pp** band
  (27 CFR 7.65(c)); claimed 6.5% vs label 6.7% = 0.2 pp (inside), above the 0.5% floor and not a
  "low/reduced alcohol" product, so neither 7.65 absolute limit fires. Brand + canonical warning
  pass -> approve. Together the three non-spirits cases exercise every concrete tolerance row.
- **Missing mandatory field -> review (completeness gate)** — brand/alcohol/warning all pass, but net
  contents (mandatory for spirits) is absent, so `combinedVerdict` takes the worse of {approve,
  completeness-review} -> **review**. Proves a label can't be approved while missing a TTB-required
  field, without auto-rejecting a possible misread.

## Per-field metrics and allocation fixtures

The eval scores per-field precision/recall on **seven** fields, not three:

- the three CFR-core checks — `brand`, `alcohol`, `warning` (off the `VerifyResult` named accessors);
- four **completeness-driving** fields whose VALUE ALLOCATION the extractor must get right —
  `classType`, `netContents`, `fancifulName`, `statementOfComposition` (off `VerifyResult.fields`,
  scored only on the cases that supply a claimed value AND a labeled expectation, so unrelated cases
  don't dilute the support counts).

Three **negative-allocation** fixtures stress the field-allocation rules from
`src/extraction/fieldCatalog.ts` (the brand / classType / fanciful-name / statement-of-composition
descriptions). Each fixture **encodes the correct allocation** in its `extracted` block and proves the
comparator accepts it:

- **`puffery-excluded-rum-approve`** — masthead `CAYO VERDE`, descriptor `SUPERIOR CARIBBEAN RUM`,
  class word `RUM`. Correct allocation: brand `Cayo Verde`, **classType `Rum` only** (the puffery
  `Superior` and geographic `Caribbean` are NOT folded into the standard of identity, 27 CFR 5.63/5.143),
  fanciful name empty. classType matches verbatim -> **pass**. (Caveat: because both `Rum` and a
  hypothetical `Superior Caribbean Rum` resolve to `distilledSpirits`, the comparator would pass on
  class *resolution* either way — so the load-bearing proof here is the ENCODED extracted classType
  value `Rum`, visible in the field-table export, not the pass/fail alone.)
- **`producer-acronym-brand-approve`** — initials masthead `NG` over `DISTILLED & BOTTLED BY:
  NORTHGATE DISTILLERY`. Correct allocation puts the **full producer name in BOTH brand and name**, so
  claimed brand `Northgate Distillery` matches the encoded brand -> **pass**. This one is genuinely
  discriminating: had the masthead-only `NG` been allocated as the brand, `Northgate Distillery` vs `NG`
  would **fail** (no shared core after suffix-stripping, low similarity) — verified by tracing the
  comparator.
- **`specialty-spiced-rum-approve`** — the only fixture exercising the `fancifulName` and
  `statementOfComposition` comparators. Brand `Cayo Verde`, classType `Rum`, **fanciful name
  `Spiced Rum`** (the distinctive/"sell" name — not the brand, not by itself the class designation), and
  a plain statement of composition. The application supplies the latter two, so both comparators run and
  match verbatim -> **pass**. The load-bearing proof is that `Spiced`/`Spiced Rum` is allocated to the
  fanciful-name/composition fields, NOT folded into brand or classType.

**What these fixtures prove — and what they do NOT.** Because the mock REPLAYS each fixture's encoded
`extracted` block (it never reads pixels), these cases prove the deterministic **comparator** handles a
correctly-allocated label — the right values flow to the right verdicts. They do **not** prove a live
vision model performs the allocation; that is a property of the prompt + model, measured only against
real images through a real provider. The fixtures pin the comparator/contract; the model's allocation
accuracy is out of scope for the offline eval (by design — the suite is hermetic).

## Calibration (Brier score + ECE)

The report adds a **calibration** block: over every scored (case, field) pair it collects the read
**confidence** the gate evaluated and whether the field's verdict was **correct** (matched its label),
then prints:

- **Brier score** — mean `(confidence − correct)²`. Lower is better; 0 is perfect.
- **ECE** (Expected Calibration Error) — the support-weighted mean gap between each reliability bin's
  mean confidence and its accuracy (10 equal-width bins). Lower is better.

On these fixtures the metrics are small but **nonzero** (the canned confidences sit below 1.0 while the
fixtures are all-correct), which is exactly what a calibration metric should surface. **Honesty note:**
the mock replays the fixtures' hand-authored confidences, so this calibrates the **harness over the
fixtures**, not a live model — a real provider's confidences (and its mistakes) would move both numbers.
It answers "are confident reads in fact correct *here*?", a sanity check on the fixtures and the gate,
not a claim about production calibration.

## Multi-sample / disagreement (a documented limitation)

The pipeline's per-field confidence is meant to be the **agreement fraction across N self-consistency
samples** (`SELF_CONSISTENCY_SAMPLES`, default 3) — a better-calibrated signal than a model's
self-reported confidence. The offline eval canNOT exercise that path: the mock provider is **forced to
`samples = 1`** (in `src/pipeline.ts`, `providers.every(p => p.name === "mock")`) so the suite and eval
stay byte-for-byte deterministic. With one sample there is no agreement fraction and no disagreement to
reconcile, so the confidences scored above are the fixtures' **authored** values, not measured agreement.

This is a deliberate, honest limitation, **not** faked. We do not synthesize a fake multi-sample spread
into the mock, because doing so would either (a) make the offline suite non-deterministic, or (b) bake in
hand-tuned "agreement" numbers that look like a measurement but aren't — both of which would make the
calibration metric dishonest. Multi-sample agreement and ensemble disagreement (`reconcile.ts`, two
providers -> `review`) are covered by their own unit tests (`src/extraction/selfConsistency.test.ts`,
`src/extraction/reconcile.test.ts`) under controlled stub providers; the end-to-end agreement-as-confidence
behavior is only observable against a real provider (`VISION_PROVIDER=openai`/`gemini`/`ensemble`) and is
out of scope for the hermetic eval.

## Real images are user-supplied (per the MANIFEST)

The tests and eval do **not** need real images. Real label images are supplied by a human **later**,
at the exact paths and to the exact specs in [`images/MANIFEST.md`](./images/MANIFEST.md), and are
only required once a story exercises a real extraction provider (`VISION_PROVIDER=openai` /
`gemini` / `llm` / `ocr`) or a live demo. Until then, the `.svg` placeholders keep the whole offline suite green. If you replace an
`.svg` with a raster image, keep the `imageFilename` in `cases.json` and the path in the MANIFEST in
lockstep — the filename is the only key the mock uses. (One real image is already wired in:
`abc-single-barrel-clean.jpg`, the ABC clean-pass demo case, plus three generated demo rasters
(`demo-*.png`); the rest are `.svg` placeholders. Four fixtures — `granite-peak-ipa-fuzzy.svg` plus
the three negative-allocation fixtures
(`cayo-verde-superior-rum.svg`, `northgate-acronym-vodka.svg`, `cayo-verde-spiced-specialty.svg`) —
still need their placeholder `.svg` + `MANIFEST.md` rows added — the eval and tests pass without them
because the mock keys off the filename string, never the bytes.)

## Editing rules

- **Never reword the canonical government warning** to make a case pass — the statutory text is
  fixed (`AGENTS.md`). The PASS cases embed it verbatim; the title-case and missing cases mutate
  only the prefix/presence, never the wording.
- Keep each case's `expected` consistent with the verdict model and the CFR tolerances above. If
  you add a case, add its row here and in the MANIFEST, add a placeholder under `images/`, and make
  sure its filename is unique.
