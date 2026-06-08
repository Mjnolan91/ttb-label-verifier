# Design Spec — Extraction Accuracy & Calibration (Thread A)

- **Date:** 2026-06-08
- **Status:** Approved (design); proceeding to plan + implementation
- **Scope:** The real-provider extraction layer only (Gemini + the shared OpenAI/Azure chat path). No change to the deterministic comparators/verdict, the mock provider's fixtures, or the offline test design. Thread B (type-driven required fields) and Thread C (UI workflow) are separate specs.

---

## 1. Context

On the live Gemini demo the reads are unreliable in two ways the user named: (a) the model is **confidently wrong** — high self-reported confidence on a misread value; and (b) it **misses information** on the label. Research against Google's official Gemini docs surfaced concrete causes and fixes (full report archived in this session; key sources cited inline below):

- **Config mismatch with Gemini 3.** The deployed model is `gemini-3.5-flash` (the Gemini 3 line), but `GeminiVisionProvider` sends `temperature: 0` and `thinkingConfig.thinkingBudget: 0` — both 2.x idioms. Google's Gemini 3 guide warns that **temperature < 1.0 on Gemini 3 can cause "looping or degraded performance,"** and that Gemini 3 uses **`thinking_level`**, not `thinkingBudget` (mixing them "causes unexpected behavior"). So our generation config may be actively degrading every read.
- **Resolution left on the floor.** We set no `media_resolution`; for dense fine print the documented lever is `HIGH` (and `ULTRA_HIGH` per-part on Gemini 3) — the single highest-impact accuracy change.
- **Self-reported confidence is poorly calibrated** on Flash-tier models (overconfident; it does not separate correct from incorrect) — which is exactly the "confidently wrong" symptom. The documented remedy is **multi-sample agreement** as the confidence signal.
- **The prompt duplicates the JSON schema**, which Google explicitly calls an anti-pattern that *lowers* output quality; per-field instructions belong in the schema `description` fields.

Invariants preserved: the deterministic "AI extracts, code compares" architecture (the model still only transcribes/observes; code makes every verdict); the **mock provider stays the default and the entire test suite + `npm run eval` stay offline** (no network, no keys); the ~5s latency target (protected by running samples in parallel). `typecheck · lint · test · eval · build` stay green.

---

## 2. A1 — Version-aware Gemini generation config

A small helper resolves the correct `generationConfig` from the model id, so 2.x-tuned params never reach a Gemini 3 model:

- **Detect the line** from the model id (e.g. a `gemini-3*` prefix ⇒ "gen3"). Conservative default: treat an unrecognized id as gen3 (the current line).
- **Temperature:** gen3 ⇒ default (`1.0`) for any single read and `~1.0` for sampling; 2.x ⇒ `0` for a single greedy read, `0.7` for sampling. Never send `< 1.0` to gen3.
- **Thinking:** gen3 ⇒ `thinkingLevel` (`"minimal"` for the transcription read — transcription does not benefit from reasoning; `"high"` for the bold pass, §A5); 2.x ⇒ `thinkingConfig.thinkingBudget` (`0` for the read, `2048` for bold). The two parameters are mutually exclusive — emit exactly one.
- **Media resolution (§A2):** `MEDIA_RESOLUTION_HIGH` for the read, `MEDIA_RESOLUTION_ULTRA_HIGH` for the bold pass on gen3; the 2.x equivalent global setting otherwise.

**Sources:** [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3), [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking), [Per-part media resolution](https://ai.google.dev/gemini-api/docs/media-resolution).

**Open detail:** the exact current Gemini 3 **pro** model id (the main read upgrades flash → pro per the approved design) is a config value — confirm in AI Studio or via a quick lookup at implementation. The provider keeps `GEMINI_MODEL` as the override and the documented default is bumped to the pro id.

## 3. A2 — Higher media resolution

Set `media_resolution: HIGH` on every extraction image (front/back/neck) — the largest single fine-print accuracy lever — and `ULTRA_HIGH` on the dedicated bold pass to maximize typographic discrimination. The chat providers (OpenAI/Azure) already send `detail: "high"`; this is the Gemini analogue. Token cost rises (~64→256 on 2.x, ~560→1120 on gen3); accepted for accuracy.

## 4. A3 — Prompt + schema restructure

Stop fighting the model:

- **Remove the duplicated JSON shape from `USER_PROMPT`.** Today `USER_PROMPT` spells out the entire `{field:{value,confidence},…}` object — a documented quality anti-pattern. The schema (`responseSchema` / `json_schema`) already constrains the shape; the prompt should not restate it.
- **Move per-field instructions into the schema `description` fields.** The model reads each property's `description` as a per-field instruction. Add a `description` to each `FIELD_CATALOG` descriptor (the single source of truth) so BOTH the Gemini `OBJECT` schema and the chat `json_schema` carry the same per-field guidance (e.g. brand vs. producer rules, "transcribe verbatim, do not normalize"). `USER_PROMPT` shrinks to the task framing + structural guidance ("read top/bottom/sides/fine print; transcribe exact digits and symbols; left-to-right for columns").
- **Mark absent fields `nullable`** so the model returns null rather than hallucinating a plausible value for a field not on the image.
- The **`SYSTEM_PROMPT` rule "transcribe, never judge compliance"** is unchanged.

**Source:** [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [Mastering Controlled Generation](https://developers.googleblog.com/en/mastering-controlled-generation-with-gemini-15-schema-adherence/).

## 5. A4 — Self-consistency (the calibration fix)

Replace the model's self-reported `confidence` float as the *primary* signal with **multi-sample agreement**:

- A new pure-ish orchestration `selfConsistentExtract(provider, image, opts)` runs the provider's `extract` **N times (default 3) in PARALLEL** at the sampling temperature (§A1). Parallel ⇒ wall-clock ≈ one call; cost ×N.
- A pure `aggregateSamples(samples: ExtractedFields[]) → ExtractedFields`: for each field, the **majority (normalized) value** wins, and **`confidence = count(majority) / N`** (3/3 → 1.0, 2/3 → 0.67, 1/3 → 0.33). The two warning flags are voted the same way (then the bold flag is overridden by §A5). Agreement maps directly onto the existing `FIELD_REVIEW_CONFIDENCE` (0.7) gate, so a disagreed field falls below threshold and the confirm panel hoists it to "Needs your check."
- **Determinism for the mock + tests:** the mock is deterministic, so N samples are identical → `aggregateSamples` yields the same values at confidence `1.0`. Self-consistency is therefore a no-op for the mock and the offline suite is unaffected. `selfConsistentExtract` is configurable (`SELF_CONSISTENCY_SAMPLES`, default 3; `1` disables).
- **Scope note:** self-consistency catches *stochastic* misreads; *systematic* misreads (the model reads the same wrong thing every time) are addressed by §A1 (un-degrading the model) + §A2 (resolution), not here.

**Source:** [Optimizing Temperature for Multi-Sample Inference](https://arxiv.org/html/2502.05234v1), [Box Extract confidence-by-consistency](https://blog.box.com/confidence-scores-box-extract-api-know-when-rely-your-extractions).

## 6. A5 — Dedicated bold pass

`warningPrefixIsBold` (the one inherently-visual, mission-critical judgment) gets its own focused call:

- **New optional capability on `VisionProvider`:** `judgeWarningBold?(image, signal): Promise<boolean | null>`. Implemented by the real providers (Gemini with `thinkingLevel: "high"` + `ULTRA_HIGH`; the OpenAI/Azure chat path shares one implementation); the **mock omits it** (no-op).
- **Focused prompt + tiny schema.** Full image (per the approved design — crop is a possible follow-up), a prompt that does ONE thing: *"Locate the government health warning. Compare the visual weight (stroke width/darkness) of the 'GOVERNMENT WARNING:' prefix to the warning body that follows it. Answer BOLDER, SAME, or CANNOT_DETERMINE."* Output is a single `enum`, mapped to `true | false | null`.
- **Orchestration in `pipeline.ts`:** after the merge, **only when the merged `warningText` is non-empty AND the active provider implements `judgeWarningBold`**, call it with its own per-call timeout (`VISION_TIMEOUT_MS`). Its result **overrides** `warningPrefixIsBold`. On timeout/error ⇒ leave `null`, which the confirm UI already surfaces as "confirm the prefix is bold." Gated on warning-present so only those reads pay the second call.

**Source:** [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking) (thinking ON for subtle visual judgments).

---

## 7. Architecture & files

- **`src/extraction/VisionProvider.ts`** — add optional `judgeWarningBold?` to the interface; add an optional sampling option (`{ temperature?: number }`) to `extract` (providers ignore it in greedy mode).
- **`src/extraction/geminiGenerationConfig.ts`** (new) — pure `buildGenerationConfig(model, { mode: "read" | "sample" | "bold" })` returning the version-aware `{ temperature, thinking*, mediaResolution }`. Unit-tested in isolation (this is where the gen2-vs-gen3 correctness lives).
- **`src/extraction/GeminiVisionProvider.ts`** — use the config helper; thread the sampling temperature; implement `judgeWarningBold`.
- **`src/extraction/LlmVisionProvider.ts` / `OpenAIVisionProvider.ts`** — share a `judgeWarningBold` chat implementation (a focused prompt + small `json_schema`); thread the sampling temperature; consume the new schema descriptions.
- **`src/extraction/fieldCatalog.ts`** — add `description` (the per-field prompt) to each descriptor; both schema builders derive descriptions from it (keeps the single-source-of-truth invariant).
- **`src/extraction/selfConsistency.ts`** (new) — `selfConsistentExtract` (parallel N) + the pure `aggregateSamples`.
- **`src/pipeline.ts`** — `runExtraction` reads each image via `selfConsistentExtract`; after the merge, run the bold pass when warranted and override the flag.
- **`src/extraction/reconcile.ts`** — self-consistency is the single-provider path; it composes with (does not replace) the existing `ensemble` cross-provider reconciliation.
- **`.env.example`** — document `GEMINI_MODEL` (pro id), `SELF_CONSISTENCY_SAMPLES` (default 3).

## 8. Testing strategy

- **Pure unit tests** (no network): `aggregateSamples` (3/3, 2/3, 1/3 agreement → values + confidence; warning-flag voting); `buildGenerationConfig` (gen3 ⇒ temp ≥1.0 + `thinkingLevel`, never `thinkingBudget`; 2.x ⇒ temp 0/0.7 + `thinkingBudget`; bold mode ⇒ thinking high + ULTRA).
- **Provider tests with an injected `fetch`** (the existing pattern): `judgeWarningBold` parses BOLDER/SAME/CANNOT_DETERMINE → true/false/null; the request carries the focused prompt + media resolution; a non-OK/short response degrades to `null`.
- **Pipeline tests** (mock provider): self-consistency over the deterministic mock yields confidence 1.0 (no-op); the bold pass overrides `warningPrefixIsBold` when a warning is present and is skipped for a provider without the capability / when no warning.
- **`npm run eval`** stays green — it runs on the **mock**, which doesn't use the prompt/config, so the eval gate is unaffected by A1–A3/A5; self-consistency is a no-op on the mock.
- **Honest coverage gap (call it out):** A1–A3 and A5 change *real-provider* behavior, which the offline suite cannot exercise (the mock ignores prompt/config). Their real effect is validated by the user's manual testing on the live Gemini demo + the structural provider unit tests — not by `eval`. The spec does not claim otherwise.

## 9. Acceptance criteria

- **AC-A1** `buildGenerationConfig` is pure + unit-tested; a gen3 model never receives `temperature < 1.0` or `thinkingBudget`; a 2.x model never receives `thinkingLevel`.
- **AC-A2** Extraction calls request `media_resolution: HIGH`; the bold pass requests `ULTRA_HIGH` (gen3).
- **AC-A3** `USER_PROMPT` no longer contains the JSON object shape; each `FIELD_CATALOG` descriptor carries a `description` that flows into both schema dialects; optional fields are `nullable`. (Asserted by a test on the prompt string + the built schema.)
- **AC-A4** `selfConsistentExtract` runs N parallel samples; `aggregateSamples` sets `confidence = agreement fraction`; a disagreed field lands `< 0.7`; the mock path is a deterministic no-op.
- **AC-A5** `judgeWarningBold` overrides `warningPrefixIsBold` only when a warning is present and the provider supports it; timeout/error ⇒ `null`; mock no-ops.
- **AC-A6** `typecheck · lint · test · eval · build` green; latency held by parallel sampling + per-call timeouts.

## 10. Risks & mitigations

- **Cost.** pro × `media HIGH` × N samples (+ a bold pass) multiplies tokens. Mitigate: N is configurable (`SELF_CONSISTENCY_SAMPLES`), samples run in parallel (latency, not cost, is the budget), the bold pass is gated on warning-present. This is the user's explicit accuracy-over-cost call.
- **Real-provider behavior can't be eval-gated** (see §8). Mitigate: structural provider tests + manual demo verification; keep changes small and reversible via env.
- **Gemini API field names** (`mediaResolution`, `thinkingLevel`, the bold enum) — confirm exact spelling against the current API during implementation (the plan's first task verifies against a live/doc reference).
- **Prompt restructure could shift extraction behavior** — guard by keeping the per-field instruction *content* identical (only its location moves from prose to schema descriptions), and verifying via the provider unit tests.

## 11. Out of scope (this spec)

- Logprob-based confidence (needs the native Google SDK; we use raw HTTP) — possible follow-up.
- Cropping the image for the bold pass (full-image per the approved design).
- Agentic code-execution OCR (Gemini-3 `code_execution` localize-then-read) — possible follow-up.
- Thread B (type-driven required fields) and Thread C (UI workflow) — separate specs. The verdict/comparator layer is untouched here.
