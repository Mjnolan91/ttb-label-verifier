# Extraction Accuracy & Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the real-provider reads accurate and well-calibrated — fix the Gemini-3 config that's degrading every read, raise image resolution, restructure the prompt, add multi-sample self-consistency as the confidence signal, and add a dedicated bold-prefix pass.

**Architecture:** A pure version-aware Gemini tuning helper feeds correct generation params per model generation + call mode. A pure `aggregateSamples` turns N parallel reads into one record whose per-field confidence IS the agreement fraction. The provider interface gains an optional `judgeWarningBold` capability; the pipeline runs self-consistency per image and a warning-gated bold pass that overrides `warningPrefixIsBold`. The mock provider and the entire offline suite/eval are untouched (self-consistency is gated off for the mock; the mock has no bold pass).

**Tech Stack:** TypeScript (strict), Vitest (injected `fetch`, no network), Google Gemini `generateContent` + OpenAI/Azure chat-completions.

**Confirmed API facts (researched against ai.google.dev, June 2026):**
- Gemini 3 **pro** id: `gemini-3.1-pro-preview`; current **flash**: `gemini-3.5-flash`. (Both are the "Gemini 3 line".)
- Gemini 3 thinking: `generationConfig.thinkingConfig.thinkingLevel` ∈ `"minimal"|"low"|"medium"|"high"` (NOT `thinkingBudget`).
- Gemini 3 temperature: keep `1.0` (below 1.0 → "looping or degraded performance").
- Media resolution: **per-part**, `mediaResolution: { level: "media_resolution_high" | "media_resolution_ultra_high" }` on the media part (Gemini 3 only).

---

## File Structure

- **Create** `src/extraction/geminiTuning.ts` — pure `geminiTuning(model, mode)` → `{ temperature, thinkingConfig, mediaResolution? }`. One responsibility: encode the gen-2.x-vs-gen-3 × read/sample/bold matrix.
- **Create** `src/extraction/selfConsistency.ts` — pure `aggregateSamples(samples)` + `selfConsistentExtract(providers, image, opts)`.
- **Modify** `src/extraction/VisionProvider.ts` — add optional `judgeWarningBold?` to the interface and an `ExtractOptions` param to `extract`.
- **Modify** `src/extraction/MockVisionProvider.ts` — accept (ignore) the new `extract` options arg; no `judgeWarningBold`.
- **Modify** `src/extraction/fieldCatalog.ts` — add a `description` (per-field extraction instruction) to each descriptor.
- **Modify** `src/extraction/LlmVisionProvider.ts` — build schema `description`s from the catalog; shrink `USER_PROMPT` (drop the JSON-shape dump); mark optional fields nullable; add a shared `judgeWarningBoldViaChat`; thread sample mode.
- **Modify** `src/extraction/OpenAIVisionProvider.ts` — implement `judgeWarningBold` via the shared chat helper; thread sample mode.
- **Modify** `src/extraction/GeminiVisionProvider.ts` — use `geminiTuning`; per-part `mediaResolution`; thread sample mode; implement `judgeWarningBold`.
- **Modify** `src/extraction/reconcile.ts` — thread `ExtractOptions` through to `provider.extract`.
- **Modify** `src/pipeline.ts` — per-image self-consistency; warning-gated bold-pass override after merge.
- **Modify** `.env.example` — document `GEMINI_MODEL` (pro id) + `SELF_CONSISTENCY_SAMPLES`.

---

### Task 1: `geminiTuning.ts` — version-aware generation config (pure)

**Files:** Create `src/extraction/geminiTuning.ts`; Test `src/extraction/geminiTuning.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { geminiTuning, isGemini3 } from "./geminiTuning";

describe("isGemini3", () => {
  it("treats gemini-3* ids (and unknown ids) as gen3, older ids as not", () => {
    expect(isGemini3("gemini-3.1-pro-preview")).toBe(true);
    expect(isGemini3("gemini-3.5-flash")).toBe(true);
    expect(isGemini3("something-unknown")).toBe(true); // conservative default = current line
    expect(isGemini3("gemini-2.0-flash")).toBe(false);
    expect(isGemini3("gemini-1.5-pro")).toBe(false);
  });
});

describe("geminiTuning — Gemini 3", () => {
  const M = "gemini-3.1-pro-preview";
  it("read mode: temp 1.0, thinkingLevel minimal, media high, no thinkingBudget", () => {
    const t = geminiTuning(M, "read");
    expect(t.temperature).toBe(1);
    expect(t.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
    expect(t.mediaResolution).toEqual({ level: "media_resolution_high" });
  });
  it("sample mode: temp 1.0 (variance is inherent at the gen3 default)", () => {
    expect(geminiTuning(M, "sample").temperature).toBe(1);
  });
  it("bold mode: thinkingLevel high + ultra-high media", () => {
    const t = geminiTuning(M, "bold");
    expect(t.thinkingConfig).toEqual({ thinkingLevel: "high" });
    expect(t.mediaResolution).toEqual({ level: "media_resolution_ultra_high" });
  });
});

describe("geminiTuning — legacy 2.x", () => {
  const M = "gemini-2.0-flash";
  it("read: temp 0 + thinkingBudget 0, no media (gen3-only feature)", () => {
    const t = geminiTuning(M, "read");
    expect(t.temperature).toBe(0);
    expect(t.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(t.mediaResolution).toBeUndefined();
  });
  it("sample: temp 0.7 to create variance for self-consistency", () => {
    expect(geminiTuning(M, "sample").temperature).toBe(0.7);
  });
  it("bold: thinkingBudget 2048", () => {
    expect(geminiTuning(M, "bold").thinkingConfig).toEqual({ thinkingBudget: 2048 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/extraction/geminiTuning.test.ts` → FAIL ("Cannot find module './geminiTuning'").

- [ ] **Step 3: Implement `src/extraction/geminiTuning.ts`**

```ts
/**
 * geminiTuning.ts — version-aware Gemini generation tuning (pure).
 *
 * Gemini 3 and Gemini 2.x take DIFFERENT params, and sending 2.x idioms to a Gemini 3 model degrades
 * it (temperature < 1.0 → "looping or degraded performance"; `thinkingBudget` is replaced by
 * `thinkingLevel`). This encodes the gen × mode matrix in one place so the provider never guesses.
 * Sources: ai.google.dev/gemini-api/docs/gemini-3, .../thinking, .../media-resolution.
 */
export type GeminiCallMode = "read" | "sample" | "bold";

export interface GeminiTuning {
  temperature: number;
  /** Exactly one of thinkingLevel (gen3) or thinkingBudget (2.x). */
  thinkingConfig: { thinkingLevel: "minimal" | "low" | "medium" | "high" } | { thinkingBudget: number };
  /** Per-part media resolution (gen3 only); undefined on 2.x. */
  mediaResolution?: { level: "media_resolution_high" | "media_resolution_ultra_high" };
}

/** Gemini 3 line by id prefix. Unknown ids default to gen3 (the current line) — conservative. */
export function isGemini3(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (/^gemini-[12]\b/.test(m) || /^gemini-1\.5|^gemini-2\./.test(m)) return false;
  return true;
}

export function geminiTuning(model: string, mode: GeminiCallMode): GeminiTuning {
  if (isGemini3(model)) {
    // Temperature must stay at the gen3 default (1.0); that default already provides sampling variance.
    return {
      temperature: 1,
      thinkingConfig: { thinkingLevel: mode === "bold" ? "high" : "minimal" },
      mediaResolution: { level: mode === "bold" ? "media_resolution_ultra_high" : "media_resolution_high" },
    };
  }
  // Legacy 2.x: greedy read, warmer sampling for variance, a thinking budget for the bold judgment.
  return {
    temperature: mode === "sample" ? 0.7 : 0,
    thinkingConfig: { thinkingBudget: mode === "bold" ? 2048 : 0 },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/extraction/geminiTuning.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extraction/geminiTuning.ts src/extraction/geminiTuning.test.ts
git commit -m "feat(extraction): version-aware Gemini generation tuning (gen3 temp/thinking/media)"
```

---

### Task 2: `aggregateSamples` — multi-sample consensus (pure)

**Files:** Create `src/extraction/selfConsistency.ts` (function `aggregateSamples` only this task); Test `src/extraction/selfConsistency.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { aggregateSamples } from "./selfConsistency";
import type { ExtractedFields } from "@/domain";

function read(brand: string, conf: number, allCaps = true): ExtractedFields {
  return {
    brand, classType: "Bourbon", alcoholContentText: "45% Alc./Vol.", netContents: "750 mL",
    warningText: "GOVERNMENT WARNING: ...", warningPrefixIsAllCaps: allCaps, warningPrefixIsBold: true,
    confidence: { brand: conf, classType: 0.9, alcoholContent: 0.9, netContents: 0.9, warningText: 0.9 },
  };
}

describe("aggregateSamples", () => {
  it("a single sample is returned unchanged (preserves the provider's own confidence)", () => {
    const only = read("Old Tom", 0.42);
    const out = aggregateSamples([only]);
    expect(out.brand).toBe("Old Tom");
    expect(out.confidence.brand).toBe(0.42); // untouched — critical for the deterministic mock
  });

  it("full agreement -> majority value at confidence 1.0", () => {
    const out = aggregateSamples([read("Old Tom", 0.6), read("Old Tom", 0.6), read("Old Tom", 0.6)]);
    expect(out.brand).toBe("Old Tom");
    expect(out.confidence.brand).toBe(1);
  });

  it("2 of 3 agree -> majority value at 0.67 (below the 0.7 review gate)", () => {
    const out = aggregateSamples([read("Old Tom", 0.9), read("Old Tom", 0.9), read("0ld T0m", 0.9)]);
    expect(out.brand).toBe("Old Tom");
    expect(out.confidence.brand).toBeCloseTo(0.667, 2);
  });

  it("votes the warning flags too (majority all-caps wins)", () => {
    const out = aggregateSamples([read("X", 0.9, true), read("X", 0.9, true), read("X", 0.9, false)]);
    expect(out.warningPrefixIsAllCaps).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/extraction/selfConsistency.test.ts` → FAIL.

- [ ] **Step 3: Implement `aggregateSamples` in `src/extraction/selfConsistency.ts`**

```ts
/**
 * selfConsistency.ts — multi-sample agreement as the confidence signal.
 *
 * Self-reported model confidence is poorly calibrated (overconfident); running the read N times and
 * measuring agreement is a better signal. `aggregateSamples` reduces N reads to one record whose
 * per-field confidence IS the fraction of samples that produced the (normalized) majority value.
 * A SINGLE sample is returned untouched, so the deterministic mock + offline eval are unaffected.
 */
import type { ExtractedFields, FieldConfidence } from "@/domain";
import { FIELD_CATALOG } from "./fieldCatalog";
import { normalizeText } from "@/compare";

type ValueKey = (typeof FIELD_CATALOG)[number]["key"];

/** The normalized-majority value among samples for one field, plus the agreement fraction. */
function vote(values: (string | undefined)[]): { value: string | undefined; agreement: number } {
  const counts = new Map<string, { raw: string | undefined; n: number }>();
  for (const v of values) {
    const key = normalizeText(v ?? "");
    const cur = counts.get(key) ?? { raw: v, n: 0 };
    cur.n += 1;
    counts.set(key, cur);
  }
  let best = { raw: values[0], n: 0 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return { value: best.raw, agreement: best.n / values.length };
}

function voteBool<T>(values: T[]): T {
  const counts = new Map<string, { raw: T; n: number }>();
  for (const v of values) {
    const k = String(v);
    const cur = counts.get(k) ?? { raw: v, n: 0 };
    cur.n += 1;
    counts.set(k, cur);
  }
  let best = { raw: values[0], n: 0 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return best.raw;
}

export function aggregateSamples(samples: ExtractedFields[]): ExtractedFields {
  if (samples.length === 0) throw new Error("aggregateSamples requires at least one sample.");
  if (samples.length === 1) return samples[0]; // preserve the provider's own confidence (mock-safe)

  const out = { ...samples[0] } as ExtractedFields;
  const confidence: FieldConfidence = { ...samples[0].confidence };
  for (const d of FIELD_CATALOG) {
    const key = d.key as ValueKey;
    const { value, agreement } = vote(samples.map((s) => (s as Record<string, string | undefined>)[key]));
    (out as Record<string, string | undefined>)[key] = value;
    confidence[d.confKey] = agreement;
  }
  out.confidence = confidence;
  out.warningPrefixIsAllCaps = voteBool(samples.map((s) => s.warningPrefixIsAllCaps));
  out.warningPrefixIsBold = voteBool(samples.map((s) => s.warningPrefixIsBold));
  return out;
}
```

> `normalizeText` is already exported from `@/compare` (see `src/compare/index.ts`). `FieldConfidence` is exported from `@/domain`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/extraction/selfConsistency.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extraction/selfConsistency.ts src/extraction/selfConsistency.test.ts
git commit -m "feat(extraction): aggregateSamples — agreement-based confidence from N reads"
```

---

### Task 3: Provider interface — `ExtractOptions` + optional `judgeWarningBold`

**Files:** Modify `src/extraction/VisionProvider.ts`, `src/extraction/MockVisionProvider.ts`. Test: existing provider tests must stay green.

- [ ] **Step 1: Extend the interface**

In `src/extraction/VisionProvider.ts`, add above the interface:

```ts
/** Per-call extraction options. `sample: true` asks the provider to read with sampling variance
 *  (for self-consistency); absent/false is the normal best-effort read. */
export interface ExtractOptions {
  sample?: boolean;
}
```

Change the `extract` signature and add the optional bold capability:

```ts
  extract(image: ImageInput, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedFields>;
  /**
   * OPTIONAL second pass: judge ONLY whether the "GOVERNMENT WARNING:" prefix is rendered bolder than
   * the warning body. Returns true (bolder) / false (same weight) / null (cannot tell or no warning).
   * Real providers implement this; the mock omits it (the pipeline skips the pass when absent).
   */
  judgeWarningBold?(image: ImageInput, signal?: AbortSignal): Promise<boolean | null>;
```

- [ ] **Step 2: Update the mock to accept (ignore) the options arg**

In `src/extraction/MockVisionProvider.ts`, change the `extract` signature to accept the third arg and ignore it (read the file; the mock keys off the filename and ignores everything else). Example:

```ts
  async extract(image: ImageInput, _signal?: AbortSignal, _options?: ExtractOptions): Promise<ExtractedFields> {
```

Import `ExtractOptions` from `./VisionProvider`. Do NOT add `judgeWarningBold` to the mock.

- [ ] **Step 3: Typecheck + run the provider suites**

Run: `npm run typecheck && npx vitest run src/extraction/`
Expected: PASS (the new params are optional, so existing call sites and the other providers still satisfy the interface).

- [ ] **Step 4: Commit**

```bash
git add src/extraction/VisionProvider.ts src/extraction/MockVisionProvider.ts
git commit -m "feat(extraction): ExtractOptions + optional judgeWarningBold on the provider interface"
```

---

### Task 4: Field-catalog descriptions + prompt/schema restructure (A3)

**Files:** Modify `src/extraction/fieldCatalog.ts`, `src/extraction/LlmVisionProvider.ts`, `src/extraction/GeminiVisionProvider.ts`. Test: `src/extraction/LlmVisionProvider.test.ts`.

- [ ] **Step 1: Write the failing test (lock the anti-pattern fix)**

Add to `src/extraction/LlmVisionProvider.test.ts`:

```ts
import { USER_PROMPT, EXTRACTION_RESPONSE_FORMAT } from "./LlmVisionProvider";

describe("prompt + schema restructure (A3)", () => {
  it("USER_PROMPT no longer duplicates the JSON object shape", () => {
    // The documented anti-pattern: restating the schema in the prompt lowers quality.
    expect(USER_PROMPT).not.toMatch(/"brand"\s*:\s*\{/);
    expect(USER_PROMPT).not.toMatch(/"confidence"\s*:\s*number/);
  });
  it("every catalog field carries a schema description (per-field instruction)", () => {
    const props = EXTRACTION_RESPONSE_FORMAT.json_schema.schema.properties as Record<string, { description?: string }>;
    expect(props.brand.description).toMatch(/transcribe/i);
    expect(props.warningText.description).toMatch(/verbatim/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/extraction/LlmVisionProvider.test.ts` → FAIL.

- [ ] **Step 3: Add `description` to each catalog descriptor**

In `src/extraction/fieldCatalog.ts`, add `description: string` to `FieldDescriptor` and a value to each entry (move the per-field guidance verbatim from the current `USER_PROMPT`). Example for the first three (do all 15, porting the existing prose):

```ts
export interface FieldDescriptor {
  // ...existing fields...
  /** Per-field extraction instruction. Becomes the schema property `description` (the model reads it). */
  description: string;
}
```

```ts
  { key: "brand", rawKey: "brand", confKey: "brand", label: "Brand name", csvColumn: "brand", group: "headline",
    description: "The fanciful product/brand mark, usually the largest text or a logo wordmark. NOT automatically the bottling company (that goes in `name`). If a short mark and a longer producer name that contains it both appear, this is the SHORT mark. Transcribe verbatim; do not normalize." },
  { key: "classType", rawKey: "classType", confKey: "classType", label: "Class / type", csvColumn: "type", group: "headline",
    description: "The full specific class/type designation (standard of identity) exactly as printed, e.g. \"Kentucky Straight Bourbon Whiskey\", \"India Pale Ale\", \"Cabernet Sauvignon\". Transcribe verbatim." },
  { key: "alcoholContentText", rawKey: "alcoholContent", confKey: "alcoholContent", label: "Alcohol content", csvColumn: "alcohol", group: "headline",
    description: "The alcohol statement verbatim, e.g. \"45% Alc./Vol. (90 Proof)\". Do not convert units or compute proof." },
  // ...continue for netContents, warningText (\"the FULL government warning, verbatim... \"\" if absent\"), class, name, address, countryOfOrigin, appellation, vintage, varietal, sulfiteDeclaration, ageStatement, commodityStatement — porting each rule from the current USER_PROMPT.
```

- [ ] **Step 4: Build schema descriptions from the catalog + shrink USER_PROMPT**

In `src/extraction/LlmVisionProvider.ts`: build `CONFIDENCED_VALUE` per field WITH its description, and replace the shape-dumping `USER_PROMPT`. Read the file, then:

```ts
// Per-field confidenced value object, carrying the catalog's per-field instruction as the description.
function confidencedValueSchema(description: string) {
  return {
    type: "object",
    description,
    properties: { value: { type: "string" }, confidence: { type: "number" } },
    required: ["value", "confidence"],
    additionalProperties: false,
  } as const;
}

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    ...Object.fromEntries(FIELD_CATALOG.map((d) => [d.rawKey, confidencedValueSchema(d.description)])),
    warningPrefixIsAllCaps: { type: "boolean", description: 'true ONLY if the "GOVERNMENT WARNING:" prefix is in ALL CAPITAL LETTERS; false if title/mixed case.' },
    warningPrefixIsBold: { type: ["boolean", "null"], description: 'true if that prefix is clearly bolder than the body; false if clearly the same weight; null if you cannot tell. When unsure, return null.' },
  },
  required: [...FIELD_CATALOG.map((d) => d.rawKey), "warningPrefixIsAllCaps", "warningPrefixIsBold"],
  additionalProperties: false,
} as const;
```

Replace `USER_PROMPT` with a short framing that does NOT restate the shape:

```ts
export const USER_PROMPT =
  "Read EVERY piece of text on this label — top, bottom, sides, and small/fine print. Transcribe each " +
  "field exactly as printed, preserving capitalization, digits, punctuation, and symbols; do not " +
  "interpret, normalize, translate, autocomplete, or correct. For multi-column layouts read left to " +
  'right. Use "" with low confidence ONLY when the text is truly not present. Each field\'s specific ' +
  "rule is given in its schema description.";
```

Update `GeminiVisionProvider.ts` `RESPONSE_SCHEMA` the same way — its `CONFIDENCED_VALUE` becomes per-field with `description` and `nullable: true` (Gemini's `nullable` dialect) for the value:

```ts
const confidencedValue = (description: string) => ({
  type: "OBJECT",
  description,
  properties: { value: { type: "STRING", nullable: true }, confidence: { type: "NUMBER" } },
  required: ["value", "confidence"],
}) as const;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    ...Object.fromEntries(FIELD_CATALOG.map((d) => [d.rawKey, confidencedValue(d.description)])),
    warningPrefixIsAllCaps: { type: "BOOLEAN" },
    warningPrefixIsBold: { type: "BOOLEAN", nullable: true },
  },
  required: [...FIELD_CATALOG.map((d) => d.rawKey), "warningPrefixIsAllCaps", "warningPrefixIsBold"],
} as const;
```

> `FIELD_CATALOG` is already imported in both providers. The chat schema test reads `EXTRACTION_RESPONSE_FORMAT.json_schema.schema.properties` — keep `EXTRACTION_RESPONSE_FORMAT` wrapping `EXTRACTION_JSON_SCHEMA` as today.

- [ ] **Step 5: Run the suite**

Run: `npx vitest run src/extraction/ && npm run typecheck`
Expected: PASS (the new A3 tests + the existing provider tests; `parseModelJson` is unchanged so parsing tests still pass).

- [ ] **Step 6: Commit**

```bash
git add src/extraction/fieldCatalog.ts src/extraction/LlmVisionProvider.ts src/extraction/GeminiVisionProvider.ts
git commit -m "feat(extraction): per-field schema descriptions + stop duplicating the schema in the prompt"
```

---

### Task 5: Gemini provider — tuning, per-part media resolution, sampling, bold pass

**Files:** Modify `src/extraction/GeminiVisionProvider.ts`; Test `src/extraction/GeminiVisionProvider.test.ts`.

- [ ] **Step 1: Write the failing tests (injected fetch)**

Add to `src/extraction/GeminiVisionProvider.test.ts` (mirror the file's existing injected-`fetch` pattern — read it first):

```ts
describe("GeminiVisionProvider — bold pass + tuning", () => {
  function fetchReturning(text: string) {
    return (async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) })) as unknown as typeof fetch;
  }
  const img = { filename: "x.jpg", data: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };
  const cfg = { apiKey: "k", model: "gemini-3.1-pro-preview" };

  it("judgeWarningBold maps BOLDER/SAME/CANNOT_DETERMINE to true/false/null", async () => {
    const bolder = new GeminiVisionProvider({ config: cfg, fetchImpl: fetchReturning('{"bold":"BOLDER"}') });
    expect(await bolder.judgeWarningBold!(img)).toBe(true);
    const same = new GeminiVisionProvider({ config: cfg, fetchImpl: fetchReturning('{"bold":"SAME"}') });
    expect(await same.judgeWarningBold!(img)).toBe(false);
    const unk = new GeminiVisionProvider({ config: cfg, fetchImpl: fetchReturning('{"bold":"CANNOT_DETERMINE"}') });
    expect(await unk.judgeWarningBold!(img)).toBeNull();
  });

  it("the read request carries gen3 thinkingLevel + per-part media resolution", async () => {
    let body: any;
    const capture = (async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }) };
    }) as unknown as typeof fetch;
    await new GeminiVisionProvider({ config: cfg, fetchImpl: capture }).extract(img);
    expect(body.generationConfig.temperature).toBe(1);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
    const mediaPart = body.contents[0].parts.find((p: any) => p.inlineData);
    expect(mediaPart.mediaResolution).toEqual({ level: "media_resolution_high" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/extraction/GeminiVisionProvider.test.ts` → FAIL.

- [ ] **Step 3: Implement**

In `src/extraction/GeminiVisionProvider.ts` (read it first): import `geminiTuning`; remove the `THINKING_BUDGET` const; in `extract`, replace the hard-coded `generationConfig` block and attach per-part media resolution. Replace the `generationConfig` build and the media part:

```ts
import { geminiTuning } from "./geminiTuning";
// ...
async extract(image: ImageInput, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedFields> {
  // ...existing base64 + url setup...
  const tuning = geminiTuning(this.config.model, options?.sample ? "sample" : "read");
  const res = await fetchWithRetry(this.fetchImpl, url, {
    method: "POST",
    headers: { "x-goog-api-key": this.config.apiKey, "content-type": "application/json" },
    signal: withHardTimeout(signal),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [
        ...(image.position ? [{ text: `This image is the ${image.position} label of the product.` }] : []),
        { text: USER_PROMPT },
        { inlineData: { mimeType: image.contentType ?? "image/jpeg", data: base64 },
          ...(tuning.mediaResolution ? { mediaResolution: tuning.mediaResolution } : {}) },
      ] }],
      generationConfig: {
        temperature: tuning.temperature,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: tuning.thinkingConfig,
      },
    }),
  });
  // ...existing response handling -> parseModelJson(content)...
}
```

Add the bold pass method (small focused schema + prompt; reuse the same fetch/parse plumbing):

```ts
private static readonly BOLD_PROMPT =
  'Look ONLY at the government health warning on this label. Compare the visual weight (stroke ' +
  'width and darkness) of the "GOVERNMENT WARNING:" prefix against the warning body text that ' +
  'follows it. Is the prefix rendered in a clearly heavier/bolder typeface than the body? ' +
  "Answer with one word: BOLDER, SAME, or CANNOT_DETERMINE. If there is no government warning, answer CANNOT_DETERMINE.";

async judgeWarningBold(image: ImageInput, signal?: AbortSignal): Promise<boolean | null> {
  if (!image.data || image.data.length === 0) return null;
  const base64 = Buffer.from(image.data).toString("base64");
  const url = `${API_BASE}/models/${this.config.model}:generateContent`;
  const tuning = geminiTuning(this.config.model, "bold");
  try {
    const res = await fetchWithRetry(this.fetchImpl, url, {
      method: "POST",
      headers: { "x-goog-api-key": this.config.apiKey, "content-type": "application/json" },
      signal: withHardTimeout(signal),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: GeminiVisionProvider.BOLD_PROMPT },
          { inlineData: { mimeType: image.contentType ?? "image/jpeg", data: base64 },
            ...(tuning.mediaResolution ? { mediaResolution: tuning.mediaResolution } : {}) },
        ] }],
        generationConfig: {
          temperature: tuning.temperature,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: { bold: { type: "STRING", enum: ["BOLDER", "SAME", "CANNOT_DETERMINE"] } }, required: ["bold"] },
          thinkingConfig: tuning.thinkingConfig,
        },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as GeminiResponse;
    const text = firstText(json.candidates?.[0]);
    if (!text) return null;
    const verdict = (JSON.parse(text) as { bold?: string }).bold;
    return verdict === "BOLDER" ? true : verdict === "SAME" ? false : null;
  } catch {
    return null; // never throw — a failed bold pass leaves the flag null (UI asks the human)
  }
}
```

Import `ExtractOptions` from `./VisionProvider`. (`firstText`, `GeminiResponse`, `API_BASE`, `MAX_OUTPUT_TOKENS`, `fetchWithRetry`, `withHardTimeout` already exist in the file.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/extraction/GeminiVisionProvider.test.ts && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extraction/GeminiVisionProvider.ts src/extraction/GeminiVisionProvider.test.ts
git commit -m "feat(extraction): Gemini tuning + per-part media resolution + judgeWarningBold"
```

---

### Task 6: Chat providers (OpenAI/Azure) — shared `judgeWarningBold` + sampling

**Files:** Modify `src/extraction/LlmVisionProvider.ts`, `src/extraction/OpenAIVisionProvider.ts`; Tests in each provider's `*.test.ts`.

- [ ] **Step 1: Write the failing test**

Add to `src/extraction/OpenAIVisionProvider.test.ts` (mirror its injected-fetch pattern):

```ts
it("judgeWarningBold maps the model's enum to true/false/null", async () => {
  const make = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
  const img = { filename: "x.jpg", data: new Uint8Array([1]), contentType: "image/jpeg" };
  const p = new OpenAIVisionProvider({ config: { apiKey: "k", model: "gpt-4.1" }, fetchImpl: (async () => make('{"bold":"BOLDER"}')) as any });
  expect(await p.judgeWarningBold!(img)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement the shared chat bold helper in `LlmVisionProvider.ts`**

Add a shared exported helper + a focused response format (reuse `callChatCompletion`'s plumbing pattern; a thin variant that returns the enum):

```ts
export const BOLD_PROMPT =
  'Look ONLY at the government health warning on this label. Compare the visual weight (stroke width ' +
  'and darkness) of the "GOVERNMENT WARNING:" prefix against the warning body that follows it. Is the ' +
  'prefix clearly bolder than the body? Respond as JSON {"bold":"BOLDER"|"SAME"|"CANNOT_DETERMINE"}. ' +
  "If there is no warning, use CANNOT_DETERMINE.";

const BOLD_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: { name: "warning_bold", strict: true, schema: {
    type: "object", properties: { bold: { type: "string", enum: ["BOLDER", "SAME", "CANNOT_DETERMINE"] } },
    required: ["bold"], additionalProperties: false } },
} as const;

/** Shared OpenAI-dialect bold judgment. Returns true/false/null; never throws. */
export async function judgeWarningBoldViaChat(opts: {
  fetchImpl: FetchLike; url: string; headers: Record<string, string>; image: ImageInput; dataUrl: string; signal?: AbortSignal;
}): Promise<boolean | null> {
  try {
    const res = await fetchWithRetry(opts.fetchImpl, opts.url, {
      method: "POST",
      headers: { ...opts.headers, "content-type": "application/json" },
      signal: withHardTimeout(opts.signal),
      body: JSON.stringify({
        messages: [{ role: "user", content: [
          { type: "text", text: BOLD_PROMPT },
          { type: "image_url", image_url: { url: opts.dataUrl, detail: "high" } },
        ] }],
        temperature: 0,
        max_tokens: 50,
        response_format: BOLD_RESPONSE_FORMAT,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const verdict = (JSON.parse(content) as { bold?: string }).bold;
    return verdict === "BOLDER" ? true : verdict === "SAME" ? false : null;
  } catch {
    return null;
  }
}
```

Then in `LlmVisionProvider` add `judgeWarningBold` calling `judgeWarningBoldViaChat` with the Azure url/headers, and accept `options` in `extract` (it has no sampling-temperature knob beyond what `buildExtractionBody` sets; thread `options?.sample` to bump `temperature` to 0.7 when sampling — add an optional `temperature` arg to `buildExtractionBody`).

- [ ] **Step 4: Implement `judgeWarningBold` + sampling in `OpenAIVisionProvider.ts`**

Read the file; add the method mirroring Azure (its own url/headers + the OpenAI model), and thread `options?.sample` to a 0.7 temperature in its `extract`.

- [ ] **Step 5: Run + typecheck**

Run: `npx vitest run src/extraction/ && npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/extraction/LlmVisionProvider.ts src/extraction/OpenAIVisionProvider.ts src/extraction/*.test.ts
git commit -m "feat(extraction): shared chat judgeWarningBold + sampling temperature (OpenAI/Azure)"
```

---

### Task 7: `selfConsistentExtract` + pipeline integration

**Files:** Modify `src/extraction/selfConsistency.ts`, `src/extraction/reconcile.ts`, `src/pipeline.ts`; Tests `src/pipeline.test.ts`, `src/extraction/selfConsistency.test.ts`.

- [ ] **Step 1: Thread `ExtractOptions` through `reconcileExtract`**

In `src/extraction/reconcile.ts` (read it first), add an `options?: ExtractOptions` param to `reconcileExtract` and pass it to each `provider.extract(image, signal, options)`. Keep the signature backward-compatible (optional).

- [ ] **Step 2: Add `selfConsistentExtract` (test first)**

Add to `src/extraction/selfConsistency.test.ts`:

```ts
import { selfConsistentExtract } from "./selfConsistency";
import type { VisionProvider } from "./VisionProvider";

it("runs N samples and aggregates to agreement-based confidence", async () => {
  const brands = ["Old Tom", "Old Tom", "0ld T0m"];
  let i = 0;
  const provider: VisionProvider = { name: "gemini", extract: async () => read(brands[i++], 0.9) };
  const out = await selfConsistentExtract([provider], { filename: "x", data: new Uint8Array([1]) }, undefined, 3);
  expect(out.brand).toBe("Old Tom");
  expect(out.confidence.brand).toBeCloseTo(0.667, 2);
});

it("with samples=1 returns a single read unchanged (mock-safe)", async () => {
  const provider: VisionProvider = { name: "mock", extract: async () => read("X", 0.33) };
  const out = await selfConsistentExtract([provider], { filename: "x" }, undefined, 1);
  expect(out.confidence.brand).toBe(0.33);
});
```

Implement in `selfConsistency.ts`:

```ts
import { reconcileExtract } from "./reconcile";
import type { ImageInput, VisionProvider } from "./VisionProvider";

/** Read the image `samples` times in PARALLEL (sampling mode) through the reconciler, then aggregate
 *  to agreement-based confidence. samples<=1 is a single normal read (preserves provider confidence). */
export async function selfConsistentExtract(
  providers: VisionProvider[],
  image: ImageInput,
  timeoutMs: number | undefined,
  samples: number,
): Promise<ExtractedFields> {
  if (samples <= 1) return reconcileExtract(providers, image, timeoutMs);
  const reads = await Promise.all(
    Array.from({ length: samples }, () => reconcileExtract(providers, image, timeoutMs, { sample: true })),
  );
  return aggregateSamples(reads);
}
```

- [ ] **Step 3: Wire the pipeline (test first)**

Add to `src/pipeline.test.ts` (read it; uses the mock provider):

```ts
it("self-consistency over the deterministic mock is a no-op (confidence preserved)", async () => {
  // mock returns fixture confidences; with samples forced to mock-safe 1, they are untouched.
  const out = await runExtraction([mockProvider], [{ filename: "old-tom-bourbon-clean.svg" }]);
  expect(out.readable).toBe(true);
});

it("overrides warningPrefixIsBold via the provider's bold pass when a warning is present", async () => {
  const provider = {
    name: "gemini" as const,
    extract: async () => readWithWarning(), // warningText present, warningPrefixIsBold: null
    judgeWarningBold: async () => true,
  };
  const out = await runExtraction([provider], [{ filename: "x", data: new Uint8Array([1]) }]);
  expect(out.extracted.warningPrefixIsBold).toBe(true);
});
```

In `src/pipeline.ts`, change `runExtraction` to use self-consistency per image and run the bold pass after the merge:

```ts
import { selfConsistentExtract } from "@/extraction";
import { resolveSelfConsistencySamples } from "@/extraction"; // small env reader (see Task 8)

export async function runExtraction(providers: VisionProvider[], images: ImageInput[], timeoutMs?: number): Promise<ExtractionOutcome> {
  if (images.length === 0) throw new Error("At least one image is required.");
  // The deterministic mock has nothing to gain from sampling; gate it off so the offline eval is unaffected.
  const samples = providers.every((p) => p.name === "mock") ? 1 : resolveSelfConsistencySamples();
  const settled = await Promise.allSettled(
    images.map((img) => selfConsistentExtract(providers, img, timeoutMs, samples)),
  );
  // ...existing reads/empty handling/merge (unchanged)...
  const extracted = reads.reduce((acc, cur) => mergeExtracted(acc, cur));

  // Dedicated bold pass: only when a warning was read AND a provider supports it. Overrides the flag.
  if (extracted.warningText && extracted.warningText.trim() !== "") {
    const bolder = providers.find((p) => typeof p.judgeWarningBold === "function");
    if (bolder) {
      const verdict = await bolder.judgeWarningBold!(images[0]).catch(() => null);
      if (verdict !== null) extracted.warningPrefixIsBold = verdict;
    }
  }
  return { readable: isExtractionReadable(extracted), extracted };
}
```

> Export `selfConsistentExtract` and `resolveSelfConsistencySamples` from `src/extraction/index.ts`.

- [ ] **Step 4: Run + typecheck**

Run: `npx vitest run src/pipeline.test.ts src/extraction/selfConsistency.test.ts && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extraction/selfConsistency.ts src/extraction/reconcile.ts src/extraction/index.ts src/pipeline.ts src/pipeline.test.ts
git commit -m "feat(pipeline): self-consistent reads + warning-gated bold-pass override"
```

---

### Task 8: Config, env, docs + full gate

**Files:** Modify `src/extraction/GeminiVisionProvider.ts` (default model), a small config reader, `.env.example`.

- [ ] **Step 1: Bump the default model + add the samples reader**

In `GeminiVisionProvider.ts` change `const DEFAULT_MODEL = "gemini-3.5-flash";` to `const DEFAULT_MODEL = "gemini-3.1-pro-preview";` (the approved pro upgrade; override stays `GEMINI_MODEL`). Add a small reader (e.g. in a new `src/extraction/config.ts` or reuse an existing config module):

```ts
/** N reads for self-consistency (default 3; 1 disables). Read from SELF_CONSISTENCY_SAMPLES. */
export function resolveSelfConsistencySamples(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SELF_CONSISTENCY_SAMPLES ?? "3");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}
```

Export it from `src/extraction/index.ts`.

- [ ] **Step 2: Document env**

In `.env.example` update the Gemini block:

```
# GEMINI_MODEL=gemini-3.1-pro-preview          # default (pro; reads subtle cues like bold best). gemini-3.5-flash is cheaper/faster.
# SELF_CONSISTENCY_SAMPLES=3                    # real-provider reads sampled N× in parallel; agreement = confidence. 1 disables.
```

- [ ] **Step 3: Full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run eval && npm run build`
Expected: all green. `eval` is unaffected (mock path: samples=1, no bold pass). Test count rises (new tuning/aggregate/provider/pipeline tests).

- [ ] **Step 4: Manual smoke (optional, needs a key)**

With `VISION_PROVIDER=gemini` + `GEMINI_MODEL=gemini-3.1-pro-preview` + a key, upload a real label on the dev server and confirm a read returns (and the warning bold flag is populated). This validates the real-provider path the offline suite can't.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(extraction): default to the Gemini pro model; document self-consistency env; gate green"
```

---

## Self-Review

**Spec coverage:** A1 → Task 1 (`geminiTuning`) + Task 5 (applied). A2 → Task 1 (media level) + Task 5 (per-part attach). A3 → Task 4 (descriptions + prompt shrink + nullable). A4 → Task 2 (`aggregateSamples`) + Task 7 (`selfConsistentExtract` + pipeline) + Task 8 (samples env, mock gate). A5 → Task 3 (interface) + Task 5 (Gemini) + Task 6 (chat) + Task 7 (pipeline override). AC-A6 (gate) → Task 8. The §8 "mock unaffected" invariant → Task 2 (single-sample passthrough) + Task 7 (mock → samples=1, no bold pass).

**Placeholder scan:** Task 4 Step 3 says "do all 15, porting the existing prose" with three worked examples — the implementer ports the remaining descriptions verbatim from the current `USER_PROMPT` (their content already exists in-repo; not invented). Task 6 Steps 3–4 describe the Azure/OpenAI symmetry with the shared helper fully written and one provider's wiring spelled out; the second mirrors it. No TBD/"add error handling".

**Type consistency:** `ExtractOptions`, `geminiTuning(model, mode)→GeminiTuning`, `aggregateSamples(ExtractedFields[])→ExtractedFields`, `selfConsistentExtract(providers, image, timeoutMs, samples)`, `judgeWarningBold(image, signal?)→Promise<boolean|null>`, `resolveSelfConsistencySamples()` are used identically across tasks. `mediaResolution: { level: ... }` placement (per-part) is flagged for a quick live-API confirm in Task 5.

**One verification flag for the implementer:** confirm the exact per-part `mediaResolution` nesting and the `gemini-3.1-pro-preview` id against the live API at Task 5/8 (preview ids and the per-part field can shift); everything else is locally testable offline.
