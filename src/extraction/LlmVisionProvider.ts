/**
 * LlmVisionProvider.ts — real fast-tier multimodal extractor.
 *
 * The reference implementation targets **Azure OpenAI** (a vision-capable chat deployment). This
 * is the in-tenant "firewall-survival" path: it runs inside the Azure tenant rather than calling a
 * third-party ML endpoint the outbound firewall would block. The VisionProvider interface stays
 * generic — only this concrete class is Azure-specific.
 *
 * Config is read from environment variables ONLY (no secrets in code). Selecting this provider
 * without the required vars errors with an actionable message; the default `mock` provider needs
 * no keys, so dev and the entire test suite are unaffected. The HTTP layer is injectable so unit
 * tests run with no live network.
 */
import type { ExtractedFields } from "@/domain";
import type { ExtractOptions, ImageInput, VisionProvider } from "./VisionProvider";
import {
  mapRawExtracted,
  type RawConfidencedValue,
  type RawExtractedFields,
} from "./extractedShape";
import { FIELD_CATALOG } from "./fieldCatalog";
import { defaultFetch, fetchWithRetry, withHardTimeout, type FetchLike } from "./http";
import { resolveOpenAIReasoningEffort, resolveSelfConsistencyTemperature, resolveWarningJudgeModel } from "./config";
import { chatParams } from "./openaiTuning";
import { RESCUE_PROMPT } from "./rescue";
import { FIELD_REVIEW_CONFIDENCE, MIN_READABLE_CONFIDENCE } from "@/compare";

/** Resolved Azure OpenAI connection config. */
export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
  /** Optional deployment for the dedicated warning judge (WARNING_JUDGE_MODEL); defaults to `deployment`. */
  judgeDeployment?: string;
}

const DEFAULT_API_VERSION = "2024-10-21";

/**
 * Completion-token ceiling. Generous because the full verbatim government warning (~30+ words) plus
 * the catalog's confidenced fields must fit; truncation is detected explicitly (finish_reason === "length")
 * rather than surfacing as a confusing JSON parse error.
 */
const MAX_OUTPUT_TOKENS = 1500;

/**
 * Strict Structured Outputs schema (the catalog's confidenced fields + the warning flags). Sent as
 * `response_format: json_schema` so the model is CONSTRAINED to this exact shape — eliminating the
 * class of silent malformed-output bugs that loose json_object mode allows. parseModelJson remains a
 * thin defensive guard for any provider/api-version that doesn't honor the constraint. Supported on
 * the default Azure api-version (2024-10-21) and on gpt-4o-2024-08-06+ / gpt-4.1 / gpt-5.x.
 *
 * Each field's schema object carries the catalog `description` so the model reads per-field rules
 * directly from the schema rather than from duplicated prose in the USER_PROMPT (Google research
 * shows duplicating the shape in the prompt lowers output quality). Value is nullable so the model
 * can signal "not present" without returning an empty string with low confidence.
 */
function confidencedValueSchema(description: string) {
  return {
    type: "object",
    description,
    properties: { value: { type: ["string", "null"] }, confidence: { type: "number" } },
    required: ["value", "confidence"],
    additionalProperties: false,
  } as const;
}

// Derived from the single source of truth (fieldCatalog) so the strict-output schema can never drift
// from the field set the mapper/merge/UI/CSV use. Per-field descriptions travel with the schema.
const CONFIDENCED_FIELDS: readonly string[] = FIELD_CATALOG.map((d) => d.rawKey);

/**
 * Schema description for the cross-image conflict report (shared verbatim with the Gemini dialect).
 * Only a JOINT multi-image read can populate it; the pipeline deterministically caps every listed
 * field into the review band (applyCrossImageConflictCaps) — the model reports the contradiction,
 * code decides what it means.
 */
export const CONFLICTING_FIELDS_DESCRIPTION =
  "Field keys (from this schema) that DIFFERENT images of the product print with genuinely DIFFERENT " +
  "values — e.g. the front label says 45% ABV while the back says 40%. List the key and lower that " +
  "field's confidence; NEVER silently pick one of the conflicting values as the answer. " +
  "Case, punctuation, spacing, or abbreviation differences are NOT conflicts, and a field present on " +
  "one image but absent on another is NOT a conflict. Empty array when there is no contradiction or " +
  "only one image.";

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    ...Object.fromEntries(FIELD_CATALOG.map((d) => [d.rawKey, confidencedValueSchema(d.description)])),
    conflictingFields: {
      type: "array",
      items: { type: "string", enum: FIELD_CATALOG.map((d) => d.rawKey) },
      description: CONFLICTING_FIELDS_DESCRIPTION,
    },
    warningPrefixIsAllCaps: {
      type: ["boolean", "null"],
      description:
        "true if the \"GOVERNMENT WARNING:\" prefix is clearly ALL CAPITAL LETTERS; false ONLY if it is " +
        "clearly title/mixed case (a real violation); null if you cannot tell. When unsure, return null — " +
        "never guess (a wrong false rejects a compliant label).",
    },
    warningPrefixIsBold: {
      type: ["boolean", "null"],
      description:
        "true if the \"GOVERNMENT WARNING:\" prefix is clearly bolder than the body text; false ONLY if it is " +
        "clearly the SAME weight as the body (a real violation); null if you cannot tell. When unsure, return " +
        "null — never guess true OR false (a wrong false rejects a compliant label).",
    },
    warningRemainderIsBold: {
      type: ["boolean", "null"],
      description:
        "true ONLY if the warning statement BODY — the text AFTER the \"GOVERNMENT WARNING:\" prefix — is " +
        "clearly rendered in BOLD type (a real violation: the remainder may not appear in bold, 27 CFR " +
        "16.22(a)(2)); false if the body is clearly regular weight; null if you cannot tell. When unsure, " +
        "return null — never guess.",
    },
    warningIsReadilyLegible: {
      type: ["boolean", "null"],
      description:
        "false ONLY if the warning statement is clearly HARD TO READ under ordinary conditions (ornate " +
        "script face, distorted or tiny type, poor contrast with the background); true if it reads easily; " +
        "null if you cannot tell. Italic or serif type that reads easily IS legible — never penalize style " +
        "alone.",
    },
  },
  required: [
    ...CONFIDENCED_FIELDS,
    "conflictingFields",
    "warningPrefixIsAllCaps",
    "warningPrefixIsBold",
    "warningRemainderIsBold",
    "warningIsReadilyLegible",
  ],
  additionalProperties: false,
} as const;

/** The Chat Completions `response_format` requesting strict structured output to the schema above. */
export const EXTRACTION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: { name: "ttb_label_fields", strict: true, schema: EXTRACTION_JSON_SCHEMA },
} as const;

/**
 * Read + validate Azure OpenAI config from env vars. Throws an actionable error listing any that
 * are unset. Defaults the optional api-version.
 */
export function readAzureOpenAIConfig(
  env: Record<string, string | undefined> = process.env,
): AzureOpenAIConfig {
  const endpoint = env.AZURE_OPENAI_ENDPOINT?.trim();
  const apiKey = env.AZURE_OPENAI_API_KEY?.trim();
  const deployment = env.AZURE_OPENAI_DEPLOYMENT?.trim();
  const apiVersion = env.AZURE_OPENAI_API_VERSION?.trim() || DEFAULT_API_VERSION;

  if (!endpoint || !apiKey || !deployment) {
    const missing: string[] = [];
    if (!endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
    if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
    if (!deployment) missing.push("AZURE_OPENAI_DEPLOYMENT");
    throw new Error(
      `Azure OpenAI (VISION_PROVIDER=llm) is not configured: set ${missing.join(", ")}. ` +
        "The default 'mock' provider needs no keys.",
    );
  }
  return { endpoint, apiKey, deployment, apiVersion, judgeDeployment: resolveWarningJudgeModel(env) };
}

export const SYSTEM_PROMPT =
  "You are a meticulous compliance assistant that TRANSCRIBES U.S. TTB alcohol-beverage labels for " +
  "verification. You read text from the image — you never judge compliance. This output is used by a " +
  "government reviewer, so precision about WHICH words belong in WHICH field matters as much as legibility. " +
  "Hard rules:\n" +
  "1. Transcribe ONLY text actually printed on the label in the image.\n" +
  "2. NEVER guess, infer, autocomplete, translate, or correct text, and NEVER add a word that is not " +
  'printed (do not invent "Spiced", "Reserve", "Aged", etc.). If a field is not legibly present, return "" ' +
  "for its value and a LOW confidence (<= 0.3).\n" +
  "3. Report per-field confidence in [0,1] honestly, reflecting both how legible the text is AND how sure " +
  "you are the words belong in that field; when unsure which field a word belongs to, lower the confidence.\n" +
  "4. TTB FIELD ALLOCATION — keep the legal categories distinct: the BRAND NAME is the name the product is " +
  "SOLD under (if there is no separate brand, the producer/bottler/importer company name is the brand — and a " +
  "masthead that is an ACRONYM / INITIALS / SHORTENING of the producer, e.g. \"ABC\" for \"ABC Distillery\", is " +
  "NOT a separate brand; use the full producer name as the brand). The " +
  "CLASS/TYPE DESIGNATION is the standard of identity (\"Rum\", \"Vodka\"). A distinctive or fanciful / \"sell\" " +
  "name (e.g. \"Spiced Rum\", \"Single Barrel\") and marketing puffery (\"Superior\", \"Premium\", \"Smooth\", " +
  "\"Handcrafted\", \"Legendary\") are NEITHER the brand NOR, by themselves, the class/type — never put them in " +
  "`brand`, and never put puffery in `classType`.\n" +
  "5. Return exactly ONE JSON object and nothing else — no prose, no markdown, no code fences.\n" +
  "6. A product may have several label images (front/back/neck). When this request contains ONE " +
  'image, extract only what is visible on it and leave the rest "" with low confidence. When it ' +
  "contains SEVERAL images, they are label panels of the SAME product: read them TOGETHER as one " +
  "label set — take each field from the image where it is most legible, and return \"\" only when " +
  "it appears on none of them.\n" +
  "7. CONFLICTS BETWEEN IMAGES: if two images print genuinely DIFFERENT values for the same field, " +
  "list that field's key in `conflictingFields` and lower its confidence — never silently pick one. " +
  "Formatting or abbreviation differences are not conflicts.";

export const USER_PROMPT =
  "Read EVERY piece of text on each label image — top, bottom, sides, and small/fine print. Transcribe " +
  "each field exactly as printed, preserving capitalization, digits, punctuation, and symbols; do not " +
  "interpret, normalize, translate, autocomplete, or correct. For multi-column layouts read left to " +
  'right. Use "" with low confidence ONLY when the text is truly not present. Each field\'s specific ' +
  "rule is given in its schema description.";

/** The user-message preamble for a JOINT multi-image read (one product, several label panels). */
export function jointReadPreamble(count: number): string {
  return (
    `These ${count} images are the label panels of ONE product (each panel's position is noted ` +
    "before its image). Read them together as one label set."
  );
}

/**
 * Confidence we stamp on a PARSE-DEGRADED field — a `{value, confidence}` cell that survived JSON
 * parsing but whose confidence is missing/non-finite (a partial/truncated/non-strict response, the
 * classic symptom of a model that didn't honor the structured-output contract). The old code coerced
 * a malformed confidence to 0, which on an empty/null value is INDISTINGUISHABLE from a CONFIDENT
 * absence — and a confident-absence warningText flips the government-warning completeness check
 * present->missing (a false hard fail). Stamping a low-but-nonzero sentinel instead routes the field
 * to human REVIEW everywhere confidence is consulted (the per-field gate in `verifyLabel`, the
 * completeness present-low-confidence path, and `isExtractionReadable`) rather than letting a parse
 * artifact masquerade as a trustworthy read. Deliberately BELOW both trust thresholds (review gate at
 * 0.7, readability floor at 0.5) yet ABOVE 0 so a single clean field still keeps the image readable.
 */
const DEGRADED_PARSE_CONFIDENCE = Math.min(FIELD_REVIEW_CONFIDENCE, MIN_READABLE_CONFIDENCE) / 10;

function coerceConfidenced(v: unknown): RawConfidencedValue | undefined {
  if (typeof v === "object" && v !== null && "value" in v) {
    const obj = v as { value?: unknown; confidence?: unknown };
    // A trustworthy read carries a finite confidence number. When it's missing/non-finite the cell is
    // a parse artifact (truncation/non-strict output): don't read it as a confident value — stamp the
    // low sentinel so the field routes to review instead of asserting an (often empty) value at full 0.
    const confidenceOk = typeof obj.confidence === "number" && Number.isFinite(obj.confidence);
    const confidence = confidenceOk ? (obj.confidence as number) : DEGRADED_PARSE_CONFIDENCE;
    return { value: String(obj.value ?? ""), confidence };
  }
  return undefined;
}

/**
 * Pull the first balanced JSON object out of a string, tolerating code fences or stray prose the
 * model may wrap around it (```json ... ```, "Here is the JSON: { ... }"). Returns null if none.
 */
function extractFirstJsonObject(content: string): string | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return content.slice(start, end + 1);
}

/**
 * Parse the model's JSON content defensively into ExtractedFields. Shared by all real providers
 * (Azure OpenAI, OpenAI-direct, Gemini); strict structured outputs make the happy path reliable,
 * but this stays as a guard that also recovers JSON a model may wrap in fences/prose.
 */
export function parseModelJson(content: string): ExtractedFields {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Recover the first balanced object before giving up (in case a model wraps it in fences/prose).
    const candidate = extractFirstJsonObject(content);
    if (candidate === null) {
      throw new Error("The model returned content that was not valid JSON.");
    }
    try {
      parsed = JSON.parse(candidate);
    } catch {
      throw new Error("The model returned content that was not valid JSON.");
    }
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The model returned an unexpected payload.");
  }
  const p = parsed as Record<string, unknown>;
  // The confidenced-value fields are DERIVED from FIELD_CATALOG — the same loop mapRawExtracted
  // uses — so the parser can never silently drop a catalog field again. (A hand-written list here
  // once omitted fancifulName/statementOfComposition and two 16.22 warning signals: the schema asked
  // the model for them, the parser discarded them, and only REAL providers were affected — the mock
  // bypasses this path, so no offline test could see it.)
  const confidenced: Partial<Record<string, RawConfidencedValue>> = {};
  for (const d of FIELD_CATALOG) {
    const cell = coerceConfidenced(p[d.rawKey]);
    if (cell) confidenced[d.rawKey] = cell;
  }
  const flag = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null);
  const raw: RawExtractedFields = {
    ...(confidenced as Partial<RawExtractedFields>),
    warningPrefixIsAllCaps: flag(p.warningPrefixIsAllCaps),
    warningPrefixIsBold: flag(p.warningPrefixIsBold),
    warningRemainderIsBold: flag(p.warningRemainderIsBold),
    warningIsReadilyLegible: flag(p.warningIsReadilyLegible),
  };
  const mapped = mapRawExtracted(raw);
  // The joint-read conflict report: model-facing raw keys -> confidence channels. Unknown keys are
  // dropped (defensive: the enum constrains the model, but this parser also guards loose dialects).
  if (Array.isArray(p.conflictingFields)) {
    const confByRaw = new Map(FIELD_CATALOG.map((d) => [d.rawKey, d.confKey]));
    const conflicts = [
      ...new Set(
        p.conflictingFields
          .map((k) => (typeof k === "string" ? confByRaw.get(k) : undefined))
          .filter((k): k is NonNullable<typeof k> => k !== undefined),
      ),
    ];
    if (conflicts.length > 0) mapped.crossImageConflicts = conflicts;
  }
  return mapped;
}

/**
 * Best-effort actionable detail for a non-OK chat-completions response. The injectable FetchLike only
 * exposes json(), so read it defensively and surface the structured `error.message`, plus the caller's
 * status hint. Never throws — a result of "" is fine.
 */
async function chatCompletionErrorDetail(
  res: { status: number; json: () => Promise<unknown> },
  hint: string,
): Promise<string> {
  let message = "";
  try {
    const body = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      const err = (body as { error?: { message?: string } }).error;
      if (err?.message) message = `: ${err.message}`;
    }
  } catch {
    // Body wasn't JSON — status + hint is enough.
  }
  return `${message}${hint}`;
}

/** One label image encoded for a chat request, with its position hint. */
export interface EncodedLabelImage {
  dataUrl: string;
  position?: string;
}

/** Encode an image's bytes as a data URL (throws the provider's actionable error when absent). */
export function encodeLabelImage(image: ImageInput, providerLabel: string): EncodedLabelImage {
  if (!image.data || image.data.length === 0) {
    throw new Error(`The ${providerLabel} provider requires image bytes (image.data).`);
  }
  return {
    dataUrl: `data:${image.contentType ?? "image/jpeg"};base64,${Buffer.from(image.data).toString("base64")}`,
    position: image.position,
  };
}

/** The shared multimodal request body (system + user-with-image(s)). Several images = ONE product's
 *  label panels read JOINTLY (each preceded by its position hint, after a joint-read preamble) —
 *  always separate image parts at full per-image resolution, never a stitched composite (see
 *  VisionProvider.extractAll). `extra` lets OpenAI add `model`; when it does, the token/temperature
 *  params adapt to the model family (gpt-5/o-series reject the classic `max_tokens`/`temperature`
 *  idioms — see openaiTuning.ts). */
export function buildExtractionBody(
  images: EncodedLabelImage[],
  extra?: Record<string, unknown>,
  temperature = 0,
): object {
  return {
    ...extra,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          ...(images.length > 1 ? [{ type: "text", text: jointReadPreamble(images.length) }] : []),
          { type: "text", text: USER_PROMPT },
          ...images.flatMap((img) => [
            ...(img.position
              ? [{ type: "text", text: `This image is the ${img.position} label of the product.` }]
              : []),
            { type: "image_url", image_url: { url: img.dataUrl, detail: "high" } },
          ]),
        ],
      },
    ],
    // EXTRACTION reads honor the env effort knob (gpt-5/o-series only; default "low"). The judge
    // below deliberately stays on "low": a 50-token binary stroke-weight answer gains nothing from
    // a long think, and the judge already runs on the strongest model.
    ...chatParams(extra?.model as string | undefined, MAX_OUTPUT_TOKENS, temperature, resolveOpenAIReasoningEffort()),
    response_format: EXTRACTION_RESPONSE_FORMAT,
  };
}

export const BOLD_PROMPT =
  'Look ONLY at the government health warning statement on this label. Compare the STROKE WEIGHT ' +
  '(line thickness and darkness) of the "GOVERNMENT WARNING:" prefix against the warning body text ' +
  "that follows it. Bold means heavier strokes than the body, whatever the style: an italic, serif, " +
  "or decorative prefix still counts as BOLDER when its strokes are clearly thicker or darker than " +
  "the body. Do not penalize italics or ornate typefaces; judge stroke weight only. Respond as JSON " +
  '{"bold":"BOLDER"|"SAME"|"CANNOT_DETERMINE"}. Use SAME only when the prefix is clearly the same ' +
  "weight as the body. If there is no warning, or the resolution or styling leaves you unsure, use " +
  "CANNOT_DETERMINE.";

const BOLD_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: { name: "warning_bold", strict: true, schema: {
    type: "object", properties: { bold: { type: "string", enum: ["BOLDER", "SAME", "CANNOT_DETERMINE"] } },
    required: ["bold"], additionalProperties: false } },
} as const;

/** One bold-judgment call against one model. `ok` distinguishes a CONSIDERED answer (including a
 *  legitimate CANNOT_DETERMINE -> null) from a failed request, so the caller can fall back only when
 *  the call itself failed — mirrors GeminiVisionProvider.judgeOnce. Never throws. */
async function judgeBoldOnce(opts: {
  fetchImpl: FetchLike; url: string; headers: Record<string, string>; dataUrl: string; signal?: AbortSignal;
  model?: string;
}): Promise<{ ok: boolean; verdict: boolean | null }> {
  try {
    const res = await fetchWithRetry(opts.fetchImpl, opts.url, {
      method: "POST",
      headers: { ...opts.headers, "content-type": "application/json" },
      signal: withHardTimeout(opts.signal),
      body: JSON.stringify({
        ...(opts.model ? { model: opts.model } : {}),
        messages: [{ role: "user", content: [
          { type: "text", text: BOLD_PROMPT },
          { type: "image_url", image_url: { url: opts.dataUrl, detail: "high" } },
        ] }],
        ...chatParams(opts.model, 50, 0),
        response_format: BOLD_RESPONSE_FORMAT,
      }),
    });
    if (!res.ok) return { ok: false, verdict: null };
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { ok: false, verdict: null };
    const verdict = (JSON.parse(content) as { bold?: string }).bold;
    return { ok: true, verdict: verdict === "BOLDER" ? true : verdict === "SAME" ? false : null };
  } catch {
    return { ok: false, verdict: null };
  }
}

/** Shared OpenAI-dialect bold judgment. Returns true/false/null; never throws.
 *  `model` is REQUIRED for api.openai.com (the body names the model there) and omitted for Azure
 *  (the deployment lives in the URL). When `fallbackModel` is given and the judge REQUEST fails
 *  (dead model id, 4xx/5xx, malformed reply — not a considered CANNOT_DETERMINE), the judgment is
 *  re-asked on it, so a strong-but-unavailable judge degrades to the extraction model's judgment,
 *  never to "no judgment at all" (mirrors the Gemini judge's fallback). */
export async function judgeWarningBoldViaChat(opts: {
  fetchImpl: FetchLike; url: string; headers: Record<string, string>; dataUrl: string; signal?: AbortSignal;
  model?: string; fallbackModel?: string;
}): Promise<boolean | null> {
  const first = await judgeBoldOnce(opts);
  if (first.ok || !opts.fallbackModel || opts.fallbackModel === opts.model) return first.verdict;
  const fallback = await judgeBoldOnce({ ...opts, model: opts.fallbackModel });
  return fallback.verdict;
}

/**
 * Subset structured-output format for the RESCUE pass: only the requested raw keys, each a plain
 * nullable string carrying its catalog description (no per-field confidence — the rescue's
 * authority is structural: agree-boost / disagree-cap semantics live in rescue.ts, not in the
 * model's self-report).
 */
export function rescueResponseFormat(rawKeys: string[]) {
  const byRaw = new Map(FIELD_CATALOG.map((d) => [d.rawKey, d]));
  return {
    type: "json_schema",
    json_schema: {
      name: "ttb_label_fields_subset",
      strict: true,
      schema: {
        type: "object",
        properties: Object.fromEntries(
          rawKeys.map((k) => [k, { type: ["string", "null"], description: byRaw.get(k)?.description ?? "" }]),
        ),
        required: rawKeys,
        additionalProperties: false,
      },
    },
  } as const;
}

/** Headroom for a rescue reply: the longest field (the verbatim statutory warning) plus slack. */
const RESCUE_MAX_OUTPUT_TOKENS = 700;

/**
 * Shared OpenAI-dialect rescue read (see rescue.ts): ONE call on the strong model, ALL images, ONLY
 * the requested fields. Returns the raw-keyed transcriptions or null when the call fails — never
 * throws (a failed rescue must leave the extraction untouched).
 */
export async function readFieldsViaChat(opts: {
  fetchImpl: FetchLike;
  url: string;
  headers: Record<string, string>;
  images: { dataUrl: string; position?: string }[];
  rawKeys: string[];
  signal?: AbortSignal;
  /** Required for api.openai.com (the body names the model); omitted for Azure (deployment in URL). */
  model?: string;
}): Promise<Record<string, string | null> | null> {
  try {
    const res = await fetchWithRetry(opts.fetchImpl, opts.url, {
      method: "POST",
      headers: { ...opts.headers, "content-type": "application/json" },
      signal: withHardTimeout(opts.signal),
      body: JSON.stringify({
        ...(opts.model ? { model: opts.model } : {}),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: RESCUE_PROMPT },
              ...opts.images.flatMap((img) => [
                ...(img.position ? [{ type: "text", text: `This image is the ${img.position} label.` }] : []),
                { type: "image_url", image_url: { url: img.dataUrl, detail: "high" } },
              ]),
            ],
          },
        ],
        // The rescue stays on "low" effort like the judge: it is a transcription, not a deduction,
        // and it already runs on the strongest model.
        ...chatParams(opts.model, RESCUE_MAX_OUTPUT_TOKENS, 0),
        response_format: rescueResponseFormat(opts.rawKeys),
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const out: Record<string, string | null> = {};
    for (const k of opts.rawKeys) {
      const v = parsed[k];
      out[k] = typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Shared OpenAI-dialect chat-completions call: POST (with retry + hard timeout), then surface non-OK /
 * HTTP-200-error / content-filter / length / empty-content failures with the given provider `label`,
 * else parse the JSON. OpenAI-direct and Azure OpenAI differ ONLY in url/headers/body and the status
 * hint, so the response handling lives here once. (Gemini uses a different dialect and stays separate.)
 */
export async function callChatCompletion(opts: {
  fetchImpl: FetchLike;
  url: string;
  headers: Record<string, string>;
  body: object;
  label: string;
  hintFor: (status: number) => string;
  signal?: AbortSignal;
}): Promise<ExtractedFields> {
  const { fetchImpl, url, headers, body, label, hintFor, signal } = opts;
  const res = await fetchWithRetry(fetchImpl, url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    signal: withHardTimeout(signal),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `${label} request failed with status ${res.status}${await chatCompletionErrorDetail(res, hintFor(res.status))}.`,
    );
  }
  const json = (await res.json()) as {
    error?: { message?: string; code?: string };
    choices?: { finish_reason?: string; message?: { content?: unknown } }[];
  };
  // Some failures arrive as HTTP 200 with a top-level error object — surface them, don't parse.
  if (json.error) {
    throw new Error(`${label} error: ${json.error.message ?? json.error.code ?? "unknown"}.`);
  }
  const choice = json.choices?.[0];
  if (choice?.finish_reason === "content_filter") {
    throw new Error(`${label} declined to read this image (content filter).`);
  }
  if (choice?.finish_reason === "length") {
    throw new Error(`${label} response was truncated (raise max_tokens).`);
  }
  const content = choice?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error(`${label} response did not include message content.`);
  }
  return parseModelJson(content);
}

export class LlmVisionProvider implements VisionProvider {
  readonly name = "llm" as const;
  private readonly config: AzureOpenAIConfig;
  private readonly fetchImpl: FetchLike;

  constructor(opts?: { config?: AzureOpenAIConfig; fetchImpl?: FetchLike }) {
    // Reads + validates env at construction so misconfiguration fails fast and clearly.
    this.config = opts?.config ?? readAzureOpenAIConfig();
    this.fetchImpl = opts?.fetchImpl ?? defaultFetch;
  }

  async extract(image: ImageInput, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedFields> {
    return this.extractAll([image], signal, options);
  }

  /** The JOINT read: every image of the product in ONE request (see VisionProvider.extractAll). */
  async extractAll(images: ImageInput[], signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedFields> {
    const encoded = images.map((img) => encodeLabelImage(img, "llm"));
    const url =
      `${this.config.endpoint.replace(/\/+$/, "")}/openai/deployments/` +
      `${this.config.deployment}/chat/completions?api-version=${this.config.apiVersion}`;
    // Base read is greedy (0); a self-consistency SAMPLE uses the env-tunable sampling temperature
    // (default ~0.4) — warm enough to surface genuine uncertainty, cool enough not to scramble a
    // verbatim transcription into spurious disagreement.
    const temperature = options?.sample ? resolveSelfConsistencyTemperature() : 0;

    return callChatCompletion({
      fetchImpl: this.fetchImpl,
      url,
      headers: { "api-key": this.config.apiKey },
      body: buildExtractionBody(encoded, undefined, temperature),
      label: "Azure OpenAI",
      hintFor: (status) =>
        status === 401 ? " (check AZURE_OPENAI_API_KEY)" : status === 429 ? " (rate limited — retry shortly)" : "",
      signal,
    });
  }

  async judgeWarningBold(image: ImageInput, signal?: AbortSignal): Promise<boolean | null> {
    if (!image.data || image.data.length === 0) return null;
    const dataUrl = `data:${image.contentType ?? "image/jpeg"};base64,${Buffer.from(image.data).toString("base64")}`;
    // The judge can run on a stronger deployment than extraction (WARNING_JUDGE_MODEL) — the warning
    // is the one check that can hard-fail a label, so it gets the best eyes available.
    const judgeDeployment = this.config.judgeDeployment ?? this.config.deployment;
    const url =
      `${this.config.endpoint.replace(/\/+$/, "")}/openai/deployments/` +
      `${judgeDeployment}/chat/completions?api-version=${this.config.apiVersion}`;
    return judgeWarningBoldViaChat({
      fetchImpl: this.fetchImpl,
      url,
      headers: { "api-key": this.config.apiKey },
      dataUrl,
      signal,
    });
  }
}
