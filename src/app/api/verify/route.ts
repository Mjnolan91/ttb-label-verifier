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
import { getActiveProviders, resolveTimeoutMs, isAbortOrTimeout, type ImageInput, type LabelPosition } from "@/extraction";
import { runExtraction, runVerification, type VerificationOutcome } from "@/pipeline";
import { checkCompleteness } from "@/compare";
import type { VerifyApiResponse } from "./contract";

const POSITIONS: readonly LabelPosition[] = ["front", "back", "neck", "other"];

// Upload guards (unauthenticated endpoint): bound memory/cost. A product has at most front/back/neck/other.
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB per image (downscaled client-side to ~2000px first)
const MAX_TOTAL_BYTES = 32 * 1024 * 1024; // 32 MB per request
// We accept any image/* type (the browser downscales to JPEG before upload). We deliberately do NOT
// magic-byte sniff: the hermetic test fixtures use throwaway bytes (the mock keys off the filename),
// and content sniffing would break that offline design. The MIME is only ever embedded in a JSON
// string sent to the provider (escaped, not an injection vector), so an image/* allowlist suffices.
function isImageType(t: string): boolean {
  return t === "" || t.toLowerCase().startsWith("image/");
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
  // Reject oversized bodies before buffering the whole multipart payload into memory.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TOTAL_BYTES) {
    return Response.json({ error: "Upload too large." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data with one or more image files." },
      { status: 400 },
    );
  }

  // Pair each image with its position BEFORE filtering, so dropping an empty part can't shift the
  // remaining files' position hints. Then keep only non-empty files.
  const rawImages = form.getAll("image");
  const rawPositions = form.getAll("position");
  const paired: { file: File; position: FormDataEntryValue | undefined }[] = [];
  for (let i = 0; i < rawImages.length; i++) {
    const f = rawImages[i];
    if (f instanceof File && f.size > 0) paired.push({ file: f, position: rawPositions[i] });
  }
  const brand = field(form, "brand");
  const alcoholContent = field(form, "alcoholContent");
  const classType = field(form, "classType");
  const netContents = field(form, "netContents");

  // At least one image is required — extraction is the primary path.
  if (paired.length === 0) {
    return Response.json({ error: "At least one image file is required." }, { status: 400 });
  }
  if (paired.length > MAX_IMAGES) {
    return Response.json({ error: `At most ${MAX_IMAGES} images per product.` }, { status: 413 });
  }
  for (const { file } of paired) {
    if (file.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: "An image is too large (max 10 MB each)." }, { status: 413 });
    }
    if (!isImageType(file.type)) {
      return Response.json({ error: "Only image files are accepted." }, { status: 415 });
    }
  }
  // Enforce the per-request total on the ACTUAL bytes, not just the declared content-length header
  // (which a client can omit or under-report) — the header check above is only an early-out.
  const totalBytes = paired.reduce((sum, { file }) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return Response.json({ error: "Upload too large." }, { status: 413 });
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
    paired.map(async ({ file, position }) => ({
      filename: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || undefined,
      position: toPosition(position),
    })),
  );

  let outcome: VerificationOutcome;
  try {
    // Each image is read (with its per-call timeout) and merged; compare only when claimed supplied.
    outcome = claimed
      ? await runVerification(providers, claimed, images, timeoutMs)
      : { ...(await runExtraction(providers, images, timeoutMs)), result: null };
  } catch (err) {
    if (isAbortOrTimeout(err)) {
      return Response.json(
        { error: "The label reader timed out. Please try again." },
        { status: 504 },
      );
    }
    // Log the upstream detail server-side; return a generic message so provider diagnostics
    // (quota/region/deployment hints) aren't disclosed to an unauthenticated caller.
    console.error("[/api/verify] extraction failed:", err);
    return Response.json(
      { error: "The label reader is temporarily unavailable. Please try again." },
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
        ? "Demo (mock) mode only recognizes the built-in test fixtures — with no API keys there is no real model reading the image. Set VISION_PROVIDER + an API key (or use the deployed URL) to read your own photos."
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
