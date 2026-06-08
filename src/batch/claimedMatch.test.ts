/**
 * claimedMatch.test.ts — resolving a product's application (claimed) values for batch verification.
 */
import { describe, it, expect } from "vitest";
import { resolveClaimedFor } from "./claimedMatch";
import type { ProductGroup } from "./pairing";
import type { ClaimedRow } from "./csv";

const map = new Map<string, ClaimedRow>([
  ["acme-front.jpg", { filename: "acme-front.jpg", brand: "Acme" }],
  ["old-tom", { filename: "old-tom", brand: "Old Tom" }],
]);

const group = (product: string, files: string[]): ProductGroup => ({
  product,
  images: files.map((f) => ({ filename: f, position: "front" as const })),
});

describe("resolveClaimedFor", () => {
  it("matches by an image filename", () => {
    expect(resolveClaimedFor(group("acme", ["acme-front.jpg", "acme-back.jpg"]), map)?.brand).toBe("Acme");
  });
  it("matches by the product stem (case-insensitive) when no filename matches", () => {
    expect(resolveClaimedFor(group("Old-Tom", ["Old-Tom.png"]), map)?.brand).toBe("Old Tom");
  });
  it("returns undefined when nothing matches", () => {
    expect(resolveClaimedFor(group("zzz", ["zzz.png"]), map)).toBeUndefined();
  });
});
