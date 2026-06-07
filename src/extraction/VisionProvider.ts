/**
 * VisionProvider.ts — the swappable extraction boundary.
 *
 * Architecture ("AI extracts, code compares"): every way of reading fields off a label image
 * lives behind this single interface. The extraction is probabilistic (per-field confidence);
 * the deterministic comparator (US-004) consumes the returned `ExtractedFields` and produces
 * the auditable verdict. Concrete providers:
 *   - `mock` (default) — hermetic, keys off the image FILENAME, runs offline with no keys.
 *   - `llm` (US-009)   — Azure OpenAI multimodal (in-tenant; firewall-survival path).
 *   - `ocr` (US-010)   — Azure AI Document Intelligence.
 *   - `openai`         — OpenAI API directly (api.openai.com); a drop-in demo path that needs no
 *                        Azure resource/quota. The interface staying generic is what makes this
 *                        a small addition; Azure (`llm`) remains the in-tenant production target.
 *
 * The interface stays GENERIC; only the concrete providers are vendor-specific. The mock stays
 * the default so the app and the entire test suite run with no network and no API keys.
 */
import type { ExtractedFields } from "@/domain";

/** The set of provider names selectable via the `VISION_PROVIDER` env var. */
export type VisionProviderName = "mock" | "llm" | "ocr" | "openai";

/**
 * The input to extraction. `filename` is the ONLY thing the mock provider keys off (hermetic
 * fixtures), so it is always required. Real providers additionally use the raw bytes; those are
 * optional here precisely so the mock/test path never needs real image data.
 */
export interface ImageInput {
  /** Original filename, e.g. "old-tom-bourbon-clean.svg". The mock's lookup key. */
  filename: string;
  /** Raw image bytes — required by real providers (llm/ocr), ignored by the mock. */
  data?: Uint8Array;
  /** MIME type, e.g. "image/jpeg" — used by real providers when present. */
  contentType?: string;
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
   * The optional `signal` lets the parallel reconciler (US-010) abort a straggler at the
   * per-call timeout; providers that perform I/O should forward it to their request.
   */
  extract(image: ImageInput, signal?: AbortSignal): Promise<ExtractedFields>;
}
