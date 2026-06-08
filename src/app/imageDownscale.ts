/**
 * imageDownscale.ts — shrink a large label photo in the browser BEFORE upload.
 *
 * Phone photos are 3–12 MP; a vision model reads a label fine at ~1400px on the long edge, and the
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
    const bitmap = await createImageBitmap(file);
    const target = computeTargetSize(bitmap.width, bitmap.height, maxEdge);
    if (!target) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
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
