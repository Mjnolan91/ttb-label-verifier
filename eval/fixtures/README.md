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
  reviewer can actually upload at the live demo and see verified end to end in mock mode.
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

## Real images are user-supplied (per the MANIFEST)

The tests and eval do **not** need real images. Real label images are supplied by a human **later**,
at the exact paths and to the exact specs in [`images/MANIFEST.md`](./images/MANIFEST.md), and are
only required once a story exercises a real extraction provider (`VISION_PROVIDER=llm` / `ocr`) or a
live demo. Until then, the `.svg` placeholders keep the whole offline suite green. If you replace an
`.svg` with a raster image, keep the `imageFilename` in `cases.json` and the path in the MANIFEST in
lockstep — the filename is the only key the mock uses. (One real image is already wired in:
`abc-single-barrel-clean.jpg`, the ABC clean-pass demo case, plus three generated demo rasters
(`demo-*.png`); the other ten remain `.svg` placeholders.)

## Editing rules

- **Never reword the canonical government warning** to make a case pass — the statutory text is
  fixed (`AGENTS.md`). The PASS cases embed it verbatim; the title-case and missing cases mutate
  only the prefix/presence, never the wording.
- Keep each case's `expected` consistent with the verdict model and the CFR tolerances above. If
  you add a case, add its row here and in the MANIFEST, add a placeholder under `images/`, and make
  sure its filename is unique.
