/**
 * POST /api/verify — read a product's label image(s) with the configured VisionProvider, run the TTB
 * completeness check, and OPTIONALLY verify against claimed application values.
 *
 * Accepts multipart/form-data: one or MORE `image` files (a product may have front/back/neck labels),
 * optional matching `position` values, plus OPTIONAL claimed fields (`brand`, `alcoholContent`,
 * `classType`, `netContents`). It ALWAYS extracts the merged label data and computes a per-beverage
 * `completeness` result; when BOTH `brand` and `alcoholContent` are supplied it ALSO returns a
 * claimed-comparison verdict. The default provider is the offline mock. Web-standard Request/Response.
 */
import type { ClaimedFields } from "@/domain";
import { getActiveProviders, resolveTimeoutMs, type ImageInput, type LabelPosition } from "@/extraction";
import { runExtraction, runVerification, type VerificationOutcome } from "@/pipeline";
import { checkCompleteness } from "@/compare";
import type { VerifyApiResponse } from "./contract";

const POSITIONS: readonly LabelPosition[] = ["front", "back", "neck", "other"];

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function toPosition(v: FormDataEntryValue | undefined): LabelPosition | undefined {
  return typeof v === "string" && (POSITIONS as readonly string[]).includes(v)
    ? (v as LabelPosition)
    : undefined;
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data with one or more image files." },
      { status: 400 },
    );
  }

  const imageFiles = form.getAll("image").filter((f): f is File => f instanceof File && f.size > 0);
  const positions = form.getAll("position");
  const brand = field(form, "brand");
  const alcoholContent = field(form, "alcoholContent");
  const classType = field(form, "classType");
  const netContents = field(form, "netContents");

  // At least one image is required — extraction is the primary path.
  if (imageFiles.length === 0) {
    return Response.json({ error: "At least one image file is required." }, { status: 400 });
  }

  // Verification is OPTIONAL: it runs only when the application's brand AND alcohol are supplied.
  const wantVerify = Boolean(brand && alcoholContent);
  const claimed: ClaimedFields | undefined = wantVerify
    ? {
        brand,
        classType: classType || undefined,
        alcoholContentText: alcoholContent,
        netContents: netContents || undefined,
      }
    : undefined;

  // Resolve provider(s) up front. A misconfigured REAL provider (e.g. VISION_PROVIDER=llm with no
  // keys) is an operator error — fail loud with an actionable 500 rather than faking a read.
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
  const timeoutMs = resolveTimeoutMs(providers);

  const images: ImageInput[] = await Promise.all(
    imageFiles.map(async (f, i) => ({
      filename: f.name,
      data: new Uint8Array(await f.arrayBuffer()),
      contentType: f.type || undefined,
      position: toPosition(positions[i]),
    })),
  );

  let outcome: VerificationOutcome;
  try {
    // Each image is read (with its per-call timeout) and merged; compare only when claimed supplied.
    outcome = claimed
      ? await runVerification(providers, claimed, images, timeoutMs)
      : { ...(await runExtraction(providers, images, timeoutMs)), result: null };
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

  // Unreadable / low-confidence: surface the right prompt, never fabricated data.
  if (!outcome.readable) {
    const usingMock = providers.every((p) => p.name === "mock");
    const confidences = Object.values(outcome.extracted.confidence).filter(
      (c): c is number => typeof c === "number",
    );
    const nothingRead = confidences.length === 0 || Math.max(...confidences) === 0;
    const message =
      usingMock && nothingRead
        ? "Demo (mock) mode only recognizes the bundled sample labels — with no API keys there is no real model reading the image. Set VISION_PROVIDER + an API key to read your own photos."
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
    completeness: checkCompleteness(outcome.extracted),
    result: outcome.result,
    ...(claimed ? { claimed } : {}),
  };
  return Response.json(payload);
}
