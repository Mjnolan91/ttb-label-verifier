/**
 * POST /api/verify — read a label with the configured VisionProvider, and OPTIONALLY verify it
 * against claimed application values.
 *
 * Accepts multipart/form-data: an `image` file (REQUIRED) plus OPTIONAL claimed fields (`brand`,
 * `alcoholContent`, `classType`, `netContents`). It ALWAYS extracts the label into structured
 * fields (the extraction-first path); when BOTH `brand` and `alcoholContent` are supplied it also
 * runs the deterministic comparator and returns a per-field verdict. The default provider is the
 * offline mock. Uses the web-standard Request/Response so it is offline-testable.
 */
import type { ClaimedFields } from "@/domain";
import { getActiveProviders, resolveTimeoutMs } from "@/extraction";
import { runExtraction, runVerification, type VerificationOutcome } from "@/pipeline";
import type { VerifyApiResponse } from "./contract";

/** Recognize the abort/timeout error the reconciler raises, so we can surface it. */
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
      { error: "Expected multipart/form-data with an image (and optional claimed field values)." },
      { status: 400 },
    );
  }

  const image = form.get("image");
  const brand = field(form, "brand");
  const alcoholContent = field(form, "alcoholContent");
  const classType = field(form, "classType");
  const netContents = field(form, "netContents");

  // Only the image is required — extraction is the primary path.
  if (!(image instanceof File) || image.size === 0) {
    return Response.json({ error: "An image file is required." }, { status: 400 });
  }

  // Verification is OPTIONAL: it runs only when the application's brand AND alcohol are supplied.
  // With neither (the default, extraction-first path) we just read the label and return its fields.
  const wantVerify = Boolean(brand && alcoholContent);
  const claimed: ClaimedFields | undefined = wantVerify
    ? {
        brand,
        classType: classType || undefined,
        alcoholContentText: alcoholContent,
        netContents: netContents || undefined,
      }
    : undefined;

  // Resolve the configured provider(s) up front. A misconfigured REAL provider (e.g.
  // VISION_PROVIDER=llm with no Azure keys) is an operator error — fail loud with an actionable
  // 500 rather than silently falling back to the mock and pretending to read the image.
  let providers;
  try {
    providers = getActiveProviders();
  } catch (err) {
    return Response.json(
      {
        error: "The label reader is not configured.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
  const providerName = providers.map((p) => p.name).join("+");
  const bytes = new Uint8Array(await image.arrayBuffer());
  const imageInput = { filename: image.name, data: bytes, contentType: image.type || undefined };
  const timeoutMs = resolveTimeoutMs(providers);

  let outcome: VerificationOutcome;
  try {
    // Reconciles the configured provider(s) in parallel and gates readability; the per-call timeout
    // is sized to the active providers (~3s mock / ~8s real, overridable via VISION_TIMEOUT_MS) so a
    // real vision call isn't aborted prematurely. Compare only when claimed values were supplied.
    outcome = claimed
      ? await runVerification(providers, claimed, imageInput, timeoutMs)
      : { ...(await runExtraction(providers, imageInput, timeoutMs)), result: null };
  } catch (err) {
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

  // Unreadable / low-confidence image: surface the right prompt, never fabricated data.
  if (!outcome.readable) {
    // Distinguish "demo mock recognized nothing" (all-zero confidence) from a genuine low-confidence
    // read, so the message is honest rather than misleadingly "blurry". INVARIANT: usingMock is false
    // under VISION_PROVIDER=llm/ocr/ensemble, so the demo-only message can NEVER appear for a real read.
    const usingMock = providers.every((p) => p.name === "mock");
    const confidences = Object.values(outcome.extracted.confidence).filter(
      (c): c is number => typeof c === "number",
    );
    const nothingRead = confidences.length === 0 || Math.max(...confidences) === 0;
    const message =
      usingMock && nothingRead
        ? "Demo (mock) mode only recognizes the bundled sample labels — with no API keys there is no real model reading the image. Try a sample on the form, or set VISION_PROVIDER + an API key to read your own photos."
        : "We couldn't read this label clearly — please re-upload a clearer, well-lit photo with the label flat and in focus.";
    const payload: VerifyApiResponse = {
      provider: providerName,
      readable: false,
      extracted: outcome.extracted,
      result: null,
      message,
      ...(claimed ? { claimed } : {}),
    };
    return Response.json(payload);
  }

  const payload: VerifyApiResponse = {
    provider: providerName,
    readable: true,
    extracted: outcome.extracted,
    result: outcome.result,
    ...(claimed ? { claimed } : {}),
  };
  return Response.json(payload);
}
