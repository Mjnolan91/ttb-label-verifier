/**
 * VisionProvider.ts — the swappable extraction boundary.
 *
 * Architecture ("AI extracts, code compares"): every way of reading fields off a label image
 * lives behind this single interface. The extraction is probabilistic (per-field confidence);
 * the deterministic comparator consumes the returned `ExtractedFields` and produces
 * the auditable verdict. Concrete providers:
 *   - `mock` (default) — hermetic, keys off the image FILENAME, runs offline with no keys.
 *   - `llm`            — Azure OpenAI multimodal (in-tenant; firewall-survival path).
 *   - `ocr`            — Azure AI Document Intelligence.
 *   - `openai`         — OpenAI API directly (api.openai.com); a drop-in demo path that needs no
 *                        Azure resource/quota. The interface staying generic is what makes this
 *                        a small addition; Azure (`llm`) remains the in-tenant production target.
 *   - `gemini`         — Google Gemini (generativelanguage.googleapis.com); another drop-in demo
 *                        path, useful for comparing a different model's reads (e.g. the warning
 *                        bold/all-caps flags) or running it in an ensemble.
 *
 * The interface stays GENERIC; only the concrete providers are vendor-specific. The mock stays
 * the default so the app and the entire test suite run with no network and no API keys.
 */
import type { ExtractedFields } from "@/domain";

/** Per-call extraction options. `sample: true` asks the provider to read with sampling variance
 *  (for self-consistency); absent/false is the normal best-effort read. */
export interface ExtractOptions {
  sample?: boolean;
}

/** The set of provider names selectable via the `VISION_PROVIDER` env var. */
export type VisionProviderName = "mock" | "llm" | "ocr" | "openai" | "gemini";

/**
 * The input to extraction. `filename` is the ONLY thing the mock provider keys off (hermetic
 * fixtures), so it is always required. Real providers additionally use the raw bytes; those are
 * optional here precisely so the mock/test path never needs real image data.
 */
/** Which label of a product this image is (TTB COLA image types). A product may have several. */
export type LabelPosition = "front" | "back" | "neck" | "other";

export interface ImageInput {
  /** Original filename, e.g. "old-tom-bourbon-clean.svg". The mock's lookup key. */
  filename: string;
  /** Raw image bytes — required by real providers (llm/ocr), ignored by the mock. */
  data?: Uint8Array;
  /** MIME type, e.g. "image/jpeg" — used by real providers when present. */
  contentType?: string;
  /** Which label this is (front/back/neck/other). A hint passed to real providers; optional. */
  position?: LabelPosition;
}

/**
 * A vision provider extracts structured label fields from an image. Implementations MUST be
 * side-effect-free with respect to the verdict (they never decide pass/review/fail — that is
 * the comparator's job) and MUST report per-field confidence so low-confidence reads can be
 * routed to human review instead of an asserted verdict.
 */
export interface VisionProvider {
  /** Stable identifier for the provider, e.g. "mock". */
  readonly name: VisionProviderName;
  /**
   * Read the label fields from the image. Never throws for an unreadable image — it returns a
   * low-confidence result with no fabricated values (the re-upload path), not an exception.
   * The optional `signal` lets the parallel reconciler abort a straggler at the
   * per-call timeout; providers that perform I/O should forward it to their request.
   */
  extract(image: ImageInput, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedFields>;
  /**
   * OPTIONAL second pass: judge ONLY whether the "GOVERNMENT WARNING:" prefix is rendered bolder than
   * the warning body. Returns true (bolder) / false (same weight) / null (cannot tell or no warning).
   * Real providers implement this; the mock omits it (the pipeline skips the pass when absent).
   */
  judgeWarningBold?(image: ImageInput, signal?: AbortSignal): Promise<boolean | null>;
  /**
   * OPTIONAL rescue pass: re-read ONLY the named fields (RAW schema keys) across ALL of a product's
   * images, on the provider's STRONGEST model. Returns each requested key's verbatim transcription,
   * or null when not legibly present; returns null overall when the call fails (the pipeline then
   * leaves the extraction untouched). Implemented by the chat providers; the mock omits it so the
   * offline suite and eval never rescue.
   */
  readFields?(images: ImageInput[], rawKeys: string[], signal?: AbortSignal): Promise<Record<string, string | null> | null>;
}
