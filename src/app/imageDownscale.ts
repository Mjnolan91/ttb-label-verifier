/**
 * imageDownscale.ts — shrink a large label photo in the browser BEFORE upload.
 *
 * Phone photos are 3–12 MP; a vision model reads a label fine at ~2000px on the long edge, and the
 * smaller payload cuts upload time, model latency, and token cost together (helping the ~5s budget).
 * The pure decision logic (`computeTargetSize` / `shouldSkipDownscale`) is separated from the canvas
 * work so it can be unit-tested without a DOM. `downscaleForUpload` NEVER throws — on any failure it
 * returns the original file, so a verify is never blocked by resizing. The original FILENAME is
 * preserved (only the bytes + type change) so the offline filename-keyed mock is never disturbed.
 */

// 2000px keeps small print (e.g. the "BOTTLED BY ..." line, sulfite declaration) legible for the
// model while still cutting multi-MP phone photos down. Bumped from 1400 after small-text misses.
export const DEFAULT_MAX_EDGE = 2000;
export const JPEG_QUALITY = 0.85;

/** Files over this byte size are RE-ENCODED to JPEG even when their pixel dimensions already fit
 *  the edge cap: a multi-MB PNG/screenshot under 2000px otherwise ships at full weight, and the
 *  server base64-encodes those bytes into EVERY self-consistency sample's request. */
export const MAX_PASSTHROUGH_BYTES = 1_500_000;

/** Whether a dimensionally-fine raster file should still be re-encoded for its byte size. */
export function needsReencode(type: string, byteLength: number): boolean {
  return !shouldSkipDownscale(type) && byteLength > MAX_PASSTHROUGH_BYTES;
}

/** File types we must not rasterize (vector/animated/non-image) — pass through untouched. */
export function shouldSkipDownscale(type: string): boolean {
  // SVG is vector (the hermetic sample stubs); GIF may be animated; non-images obviously skip.
  return !type.startsWith("image/") || type === "image/svg+xml" || type === "image/gif";
}

/**
 * Compute the target size for a longest-edge cap, preserving aspect ratio. Returns null when the
 * image already fits within `maxEdge` (no work needed) or the dimensions are degenerate.
 */
export function computeTargetSize(
  width: number,
  height: number,
  maxEdge: number = DEFAULT_MAX_EDGE,
): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0 || longest <= maxEdge) return null;
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Downscale an image File so its longest edge is <= maxEdge, re-encoded as JPEG. Returns the ORIGINAL
 * file unchanged when it's vector/small/unsupported or if anything goes wrong (never throws). The
 * filename is preserved; only the bytes and MIME type change.
 */
export async function downscaleForUpload(
  file: File,
  maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<File> {
  if (shouldSkipDownscale(file.type)) return file;
  try {
    // `imageOrientation: "from-image"` bakes the EXIF orientation into the bitmap BEFORE we draw to
    // the canvas and re-encode (which drops the orientation tag). Without it, a portrait phone photo
    // would be sent to the model sideways — self-inflicted "bad image" on the brief's primary input.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const target = computeTargetSize(bitmap.width, bitmap.height, maxEdge);
    // Dimensions fit AND the bytes are modest -> pass through. A heavy file still gets re-encoded
    // to JPEG at its current size (needsReencode): byte weight matters even when pixels don't.
    if (!target && !needsReencode(file.type, file.size)) {
      bitmap.close();
      return file;
    }
    const { width, height } = target ?? { width: bitmap.width, height: bitmap.height };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return file;
    // Keep the original name (the mock keys off it); only bytes + type change.
    return new File([blob], file.name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
