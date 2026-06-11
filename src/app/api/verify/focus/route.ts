/**
 * POST /api/verify/focus — the batch second look's server side: ONE bounded, focused re-read of
 * the named fields across a product's images, on the provider's strong model (the rescue's
 * `readFields` machinery, so the prompt is built for exactly those entries). The client merges the
 * recoveries into the row it already has (fill-empty-only, review-band confidence) — this route
 * never re-runs the full pipeline and never computes a verdict.
 *
 * Same upload guards as /api/verify (unauthenticated endpoint) — with one cost asymmetry worth
 * naming: /api/verify spends N fast-model samples per request, while this route is a direct
 * handle on the provider's STRONGEST (most expensive) model, one bounded call per request. The
 * per-client rate limiting both routes lack belongs to an API gateway in production; on the
 * public demo, SECOND_LOOK=0 turns this route into a no-op (supported:false) if abuse appears.
 *
 * Providers without `readFields` (the offline mock, the OCR path) and a SECOND_LOOK=0 environment
 * report `supported: false` so the row's note stays honest instead of pretending a look happened.
 */
import {
  getActiveProviders,
  resolveRescueTimeoutMs,
  resolveSecondLook,
  resolveTimeoutMs,
  runSecondLook,
  SECOND_LOOK_ALLOWED,
  type ImageInput,
  type LabelPosition,
  type SecondLookKey,
} from "@/extraction";
import { readBodyWithinCap } from "../route";
import type { FocusApiResponse } from "../contract";

// One strong-model read (resolveRescueTimeoutMs clamps to 30s) plus parsing headroom.
export const maxDuration = 45;

const POSITIONS: readonly LabelPosition[] = ["front", "back", "neck", "other"];
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

function isImageType(t: string): boolean {
  return t === "" || t.toLowerCase().startsWith("image/");
}

function toPosition(v: FormDataEntryValue | undefined): LabelPosition | undefined {
  return typeof v === "string" && (POSITIONS as readonly string[]).includes(v)
    ? (v as LabelPosition)
    : undefined;
}

export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TOTAL_BYTES) {
    return Response.json({ error: "Upload too large." }, { status: 413 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  let form: FormData;
  try {
    const body = await readBodyWithinCap(request.body, MAX_TOTAL_BYTES);
    if (body === "too-large") return Response.json({ error: "Upload too large." }, { status: 413 });
    form =
      body === null
        ? await request.formData()
        : await new Response(new Blob([body]), { headers: { "content-type": contentType } }).formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data with one or more image files." },
      { status: 400 },
    );
  }

  const rawImages = form.getAll("image");
  const rawPositions = form.getAll("position");
  const paired: { file: File; position: FormDataEntryValue | undefined }[] = [];
  for (let i = 0; i < rawImages.length; i++) {
    const f = rawImages[i];
    if (f instanceof File && f.size > 0) paired.push({ file: f, position: rawPositions[i] });
  }
  if (paired.length === 0) {
    return Response.json({ error: "At least one image file is required." }, { status: 400 });
  }
  if (paired.length > MAX_IMAGES) {
    return Response.json({ error: `At most ${MAX_IMAGES} images per product.` }, { status: 413 });
  }
  let totalBytes = 0;
  for (const { file } of paired) {
    if (file.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: "An image is too large (max 10 MB each)." }, { status: 413 });
    }
    if (!isImageType(file.type)) {
      return Response.json({ error: "Only image files are accepted." }, { status: 415 });
    }
    totalBytes += file.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return Response.json({ error: "Upload too large." }, { status: 413 });
  }

  // The fields to re-read: a comma-separated subset of the second-look allowlist. An unknown key is
  // a caller bug — fail loud rather than silently reading a different field set.
  const fieldsRaw = form.get("fields");
  const keys = (typeof fieldsRaw === "string" ? fieldsRaw : "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (keys.length === 0) {
    return Response.json({ error: "At least one field key is required." }, { status: 400 });
  }
  const unknown = keys.filter((k) => !SECOND_LOOK_ALLOWED.has(k as SecondLookKey));
  if (unknown.length > 0) {
    return Response.json({ error: `Unknown field key(s): ${unknown.join(", ")}.` }, { status: 400 });
  }

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
  const reader = providers.find((p) => typeof p.readFields === "function");
  if (!reader || !resolveSecondLook()) {
    const payload: FocusApiResponse = { provider: providerName, supported: false, fields: {} };
    return Response.json(payload);
  }

  const images: ImageInput[] = await Promise.all(
    paired.map(async ({ file, position }) => ({
      filename: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || undefined,
      position: toPosition(position),
    })),
  );

  const findings = await runSecondLook(
    reader,
    images,
    keys as SecondLookKey[],
    resolveRescueTimeoutMs(resolveTimeoutMs(providers)),
  );
  const payload: FocusApiResponse =
    findings === null
      ? { provider: providerName, supported: true, failed: true, fields: {} }
      : { provider: providerName, supported: true, fields: findings as FocusApiResponse["fields"] };
  return Response.json(payload);
}
