/**
 * contract.ts — the JSON shape of POST /api/verify, shared by the route and the UI so they
 * never drift. Types only (no runtime), safe to import into client components.
 */
import type { ClaimedFields, ExtractedFields } from "@/domain";
import type { VerifyResult } from "@/compare";

/** Successful verify response. */
export interface VerifyApiResponse {
  provider: string;
  claimed: ClaimedFields;
  extracted: ExtractedFields;
  result: VerifyResult;
}

/** Error response (4xx/5xx). */
export interface VerifyApiError {
  error: string;
  detail?: string;
}
