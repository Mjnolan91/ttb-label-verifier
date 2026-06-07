/**
 * contract.ts — the JSON shape of POST /api/verify, shared by the route and the UI so they
 * never drift. Types only (no runtime), safe to import into client components.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import type { VerifyResult } from "@/compare";

/** Successful verify response. */
export interface VerifyApiResponse {
  provider: string;
  /**
   * Whether the label was readable. When false, the extraction had no confident signal (a
   * blurry/glare photo or an unrecognized image): `result` is null and `message` is the
   * "re-upload a clearer photo" prompt — never a fabricated verdict (US-008).
   */
  readable: boolean;
  claimed: ClaimedFields;
  extracted: ExtractedFields;
  /** The verdict, or null when the image was unreadable. */
  result: VerifyResult | null;
  /** Human-facing message for the unreadable/low-confidence path. */
  message?: string;
}

/** Error response (4xx/5xx). */
export interface VerifyApiError {
  error: string;
  detail?: string;
}
