/**
 * contract.ts — the JSON shape of POST /api/verify, shared by the route and the UI so they never
 * drift. Extraction-first: `extracted` is always present (when readable); `claimed` and `result`
 * appear only when the caller supplied claimed values and the optional verification ran. Types only
 * (no runtime), safe to import into client components.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import type { VerifyResult, CompletenessResult } from "@/compare";
import type { ImageReadFailure } from "@/pipeline";

/** Successful analyze response (extraction, plus an optional verdict). */
export interface VerifyApiResponse {
  provider: string;
  /**
   * Whether the label was readable. When false, the extraction had no confident signal (a
   * blurry/glare photo or an unrecognized image): `result` is null and `message` is the
   * "re-upload a clearer photo" prompt — never fabricated data.
   */
  readable: boolean;
  /** What the AI read off the label. Always present on a readable response. */
  extracted: ExtractedFields;
  /** TTB completeness check (per beverage type) — present on a readable response. */
  completeness?: CompletenessResult;
  /** The claimed application values — present only when verification was requested. */
  claimed?: ClaimedFields;
  /** The verdict — present only when claimed values were supplied AND the image was readable. */
  result: VerifyResult | null;
  /** Human-facing message for the unreadable/low-confidence path. */
  message?: string;
  /**
   * Images of the product that could NOT be read while the rest succeeded (per-image timeout or
   * provider error). Present only when non-empty. The UI must surface these: the extracted fields
   * reflect only the surviving images, and a silently dropped back label would otherwise read as
   * "the label is missing its mandatory fields".
   */
  imageFailures?: ImageReadFailure[];
}

/** Error response (4xx/5xx). */
export interface VerifyApiError {
  error: string;
  detail?: string;
}

/**
 * POST /api/verify/focus — the batch second look's focused re-read of named fields. `fields` maps
 * each recovered channel to its value at review-band confidence (0.65 — surfaced for a person,
 * never a silent pass); empty when the strong model couldn't find them either.
 */
export interface FocusApiResponse {
  provider: string;
  /** False when the pass can't run here: the provider has no focused-read capability (the offline
   *  mock) or SECOND_LOOK=0 disabled it. */
  supported: boolean;
  /** True when the pass was supported but the focused read itself failed or timed out — distinct
   *  from "ran and found nothing", so the row note never claims a look that didn't happen. */
  failed?: boolean;
  fields: Record<string, { value: string; confidence: number }>;
}
