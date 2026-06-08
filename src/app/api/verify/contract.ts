/**
 * contract.ts — the JSON shape of POST /api/verify, shared by the route and the UI so they never
 * drift. Extraction-first: `extracted` is always present (when readable); `claimed` and `result`
 * appear only when the caller supplied claimed values and the optional verification ran. Types only
 * (no runtime), safe to import into client components.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import type { VerifyResult, CompletenessResult } from "@/compare";

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
}

/** Error response (4xx/5xx). */
export interface VerifyApiError {
  error: string;
  detail?: string;
}
