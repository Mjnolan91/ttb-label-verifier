/**
 * POST /api/verify — run extraction then deterministic comparison for one label.
 *
 * Accepts multipart/form-data: an `image` file plus the claimed field values (`brand`,
 * `alcoholContent`, optional `classType`, `netContents`). Calls the configured VisionProvider
 * (mock by default — offline), then verifyLabel(), and returns the per-field results plus an
 * overall verdict as JSON. Uses the web-standard Request/Response so it is offline-testable.
 */
import type { ClaimedFields } from "@/domain";
import { getActiveProviders } from "@/extraction";
import { runVerification } from "@/pipeline";
import type { VerifyApiResponse } from "./contract";

/** Recognize the abort/timeout error the US-010 reconciler raises, so US-008 can surface it. */
function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data with an image and the claimed field values." },
      { status: 400 },
    );
  }

  const image = form.get("image");
  const brand = field(form, "brand");
  const alcoholContent = field(form, "alcoholContent");
  const classType = field(form, "classType");
  const netContents = field(form, "netContents");

  // Validation -> clear 4xx.
  if (!(image instanceof File) || image.size === 0) {
    return Response.json({ error: "An image file is required." }, { status: 400 });
  }
  const missing: string[] = [];
  if (!brand) missing.push("brand");
  if (!alcoholContent) missing.push("alcoholContent");
  if (missing.length > 0) {
    return Response.json(
      { error: `Missing required field(s): ${missing.join(", ")}.` },
      { status: 400 },
    );
  }

  const claimed: ClaimedFields = {
    brand,
    classType: classType || undefined,
    alcoholContentText: alcoholContent,
    netContents: netContents || undefined,
  };

  const providers = getActiveProviders();
  const providerName = providers.map((p) => p.name).join("+");
  const bytes = new Uint8Array(await image.arrayBuffer());

  let outcome;
  try {
    // Reconciles the configured provider(s) in parallel (per-call timeout), gates readability, compares.
    outcome = await runVerification(providers, claimed, {
      filename: image.name,
      data: bytes,
      contentType: image.type || undefined,
    });
  } catch (err) {
    // Provider-timeout message is driven by the per-call timeout machinery built in US-010
    // (Promise.allSettled + AbortController); this route only SURFACES it to the user.
    if (isTimeoutError(err)) {
      return Response.json(
        { error: "The label reader timed out. Please try again." },
        { status: 504 },
      );
    }
    return Response.json(
      { error: "Extraction failed.", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Unreadable / low-confidence image: surface the right prompt, never a fabricated verdict.
  if (!outcome.readable || !outcome.result) {
    // Distinguish "demo mock recognized nothing" (all-zero confidence) from a genuine
    // low-confidence read, so the message is honest rather than misleadingly "blurry".
    const usingMock = providers.every((p) => p.name === "mock");
    const confidences = Object.values(outcome.extracted.confidence).filter(
      (c): c is number => typeof c === "number",
    );
    const nothingRead = confidences.length === 0 || Math.max(...confidences) === 0;
    const message =
      usingMock && nothingRead
        ? "Demo (mock) mode only recognizes the bundled sample labels — with no API keys there is no real model reading the image. Try a sample on the form, or set VISION_PROVIDER + Azure credentials to read your own photos."
        : "We couldn't read this label clearly — please re-upload a clearer, well-lit photo with the label flat and in focus.";
    const payload: VerifyApiResponse = {
      provider: providerName,
      readable: false,
      claimed,
      extracted: outcome.extracted,
      result: null,
      message,
    };
    return Response.json(payload);
  }

  const payload: VerifyApiResponse = {
    provider: providerName,
    readable: true,
    claimed,
    extracted: outcome.extracted,
    result: outcome.result,
  };
  return Response.json(payload);
}
