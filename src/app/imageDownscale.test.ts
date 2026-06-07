/**
 * imageDownscale.test.ts — the pure resize-decision logic (no DOM needed, runs in node).
 * The canvas/createImageBitmap path in downscaleForUpload is exercised in-browser during the UI
 * verification pass; here we lock down the size math and the skip rules.
 */
import { describe, it, expect } from "vitest";
import { computeTargetSize, shouldSkipDownscale, DEFAULT_MAX_EDGE } from "./imageDownscale";

describe("shouldSkipDownscale", () => {
  it("skips vector, animated, and non-image types", () => {
    expect(shouldSkipDownscale("image/svg+xml")).toBe(true);
    expect(shouldSkipDownscale("image/gif")).toBe(true);
    expect(shouldSkipDownscale("application/pdf")).toBe(true);
    expect(shouldSkipDownscale("")).toBe(true);
  });

  it("downscales raster photo types", () => {
    expect(shouldSkipDownscale("image/jpeg")).toBe(false);
    expect(shouldSkipDownscale("image/png")).toBe(false);
    expect(shouldSkipDownscale("image/webp")).toBe(false);
  });
});

describe("computeTargetSize", () => {
  it("returns null when the image already fits within maxEdge", () => {
    expect(computeTargetSize(1000, 800)).toBeNull();
    expect(computeTargetSize(DEFAULT_MAX_EDGE, 500)).toBeNull();
  });

  it("scales the longest edge down to maxEdge, preserving aspect ratio (landscape)", () => {
    expect(computeTargetSize(4000, 3000, 1400)).toEqual({ width: 1400, height: 1050 });
  });

  it("handles portrait orientation (height is the longest edge)", () => {
    expect(computeTargetSize(3000, 4000, 1400)).toEqual({ width: 1050, height: 1400 });
  });

  it("returns null for degenerate sizes", () => {
    expect(computeTargetSize(0, 0)).toBeNull();
    expect(computeTargetSize(Number.NaN, 100)).toBeNull();
  });
});
