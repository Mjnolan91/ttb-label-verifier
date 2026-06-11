/**
 * pairing.test.ts — the batch front/back/neck grouping convention.
 */
import { describe, it, expect } from "vitest";
import { groupImagesByProduct, parsePositionToken } from "./pairing";

describe("parsePositionToken", () => {
  it("reports an EXPLICIT position token, and null when the filename carries none", () => {
    // The single screen's multi-file placement needs the difference: an explicit "-back" claims the
    // Back slot; a tokenless file fills empty slots in order. groupImagesByProduct's tokenless
    // default ("front") cannot express that distinction.
    expect(parsePositionToken("acme-back.jpg")).toEqual({ product: "acme", position: "back" });
    expect(parsePositionToken("acme_n.png")).toEqual({ product: "acme", position: "neck" });
    expect(parsePositionToken("IMG_1234.jpg")).toEqual({ product: "IMG_1234", position: null });
    expect(parsePositionToken("demo-old-tom-clean.png")).toEqual({ product: "demo-old-tom-clean", position: null });
  });

  it("strips download and copy suffixes before parsing the token", () => {
    expect(parsePositionToken("acme-back (1).jpg").position).toBe("back");
    expect(parsePositionToken("acme-back(1).jpg").position).toBe("back");
    expect(parsePositionToken("acme-back - Copy.jpg").position).toBe("back");
  });
});

describe("groupImagesByProduct", () => {
  it("pairs front + back of one product by shared base name", () => {
    const groups = groupImagesByProduct(["acme-ipa-front.jpg", "acme-ipa-back.jpg"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].product).toBe("acme-ipa");
    expect(groups[0].images.map((i) => i.position)).toEqual(["front", "back"]);
  });

  it("treats a file with no position token as a single-image (front) product", () => {
    const groups = groupImagesByProduct(["old-tom.jpg"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].product).toBe("old-tom");
    expect(groups[0].images).toEqual([{ filename: "old-tom.jpg", position: "front" }]);
  });

  it("does NOT split on a trailing word that isn't a position token", () => {
    const groups = groupImagesByProduct(["demo-old-tom-clean.png"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].product).toBe("demo-old-tom-clean");
  });

  it("groups several products and preserves first-seen order", () => {
    const groups = groupImagesByProduct(["a-front.jpg", "b.png", "a-back.jpg"]);
    expect(groups.map((g) => g.product)).toEqual(["a", "b"]);
    expect(groups[0].images).toHaveLength(2); // a: front + back
    expect(groups[1].images).toHaveLength(1); // b: single
  });

  it("strips the browser download-rename ' (n)' so a re-downloaded back label still pairs", () => {
    const groups = groupImagesByProduct(["acme-front.jpg", "acme-back (1).jpg"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].product).toBe("acme");
    expect(groups[0].images.map((i) => i.position)).toEqual(["front", "back"]);
  });

  it("pairs Windows Explorer ' - Copy' and no-space '(n)' duplicates with their product", () => {
    expect(groupImagesByProduct(["acme-front.jpg", "acme-back - Copy.jpg"])).toHaveLength(1);
    expect(groupImagesByProduct(["acme-front.jpg", "acme-back(1).jpg"])).toHaveLength(1);
  });

  it("recognizes _, space, and short-form tokens, and neck", () => {
    expect(groupImagesByProduct(["p1_back.png"])[0].images[0].position).toBe("back");
    expect(groupImagesByProduct(["wine front.jpg"])[0]).toMatchObject({ product: "wine" });
    expect(groupImagesByProduct(["p2-neck.jpg"])[0].images[0].position).toBe("neck");
    expect(groupImagesByProduct(["p3-f.jpg"])[0].images[0].position).toBe("front");
  });
});
