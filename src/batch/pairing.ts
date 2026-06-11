/**
 * pairing.ts — group a batch of uploaded image filenames into PRODUCTS, mirroring TTB's COLA model
 * (a product has one or more images, each a position: front/back/neck/other). Pairing is by a
 * filename convention so it's deterministic and visible to the user: a trailing position token after
 * a separator (`__`, `-`, `_`, or space) marks the position; the rest of the name is the product.
 *
 *   acme-ipa-front.jpg + acme-ipa-back.jpg  ->  product "acme-ipa" with [front, back]
 *   old-tom.jpg                              ->  product "old-tom" with [front]   (no token)
 *
 * Tokens: front|f|brand|full -> front, back|b -> back, neck|n|strip -> neck, other|o -> other.
 * "strip" and "full" mirror the single screen's own slot names ("Neck / strip label",
 * "Front / full label") — a real reviewer batch named its tequila's third image
 * Casamigos_Tequila_Strip.jpg and the strip read ALONE as its own product, exactly the
 * panel-alone "missing fields" failure batch mode exists to avoid. Unrecognized trailing words
 * (e.g. "clean") are NOT positions — the file is a single-image product.
 */
import type { LabelPosition } from "@/extraction";

export interface ProductImage {
  filename: string;
  position: LabelPosition;
}
export interface ProductGroup {
  /** The product key (filename stem with the position token removed). */
  product: string;
  images: ProductImage[];
}

const POSITION_TOKENS: Record<string, LabelPosition> = {
  front: "front",
  f: "front",
  brand: "front",
  full: "front",
  back: "back",
  b: "back",
  neck: "neck",
  n: "neck",
  strip: "neck",
  other: "other",
  o: "other",
};

/**
 * Parse one filename into its product stem and its EXPLICIT position token, or `position: null`
 * when the name carries none. The null matters to the single screen's multi-file placement: an
 * explicit "-back" claims the Back slot, while a tokenless file fills empty slots in order —
 * a distinction the grouping default ("tokenless = front") cannot express.
 */
export function parsePositionToken(filename: string): { product: string; position: LabelPosition | null } {
  // Browsers rename a repeat download to "name (1).png"; Windows Explorer makes "name - Copy.png"
  // and "name(1).png". Strip those (repeatedly — "name - Copy (2)" stacks) so a re-downloaded or
  // duplicated back label still pairs with its front and the position token is still recognized.
  let stem = filename.replace(/\.[^.]+$/, "");
  for (;;) {
    const next = stem.replace(/(?:\s*\(\d+\)|\s+-\s+copy)$/i, "");
    if (next === stem) break;
    stem = next;
  }
  const m = stem.match(/^(.*?)[\s_-]+([a-z]+)$/i);
  if (m) {
    const token = m[2].toLowerCase();
    const position = POSITION_TOKENS[token];
    if (position) {
      const product = m[1].trim();
      return { product: product || stem, position };
    }
  }
  return { product: stem, position: null };
}

function parseName(filename: string): { product: string; position: LabelPosition } {
  const { product, position } = parsePositionToken(filename);
  return { product, position: position ?? "front" };
}

/** Group filenames into products (order of first appearance preserved). */
export function groupImagesByProduct(filenames: string[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  const order: string[] = [];
  for (const filename of filenames) {
    const { product, position } = parseName(filename);
    const key = product.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { product, images: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.images.push({ filename, position });
  }
  return order.map((k) => groups.get(k) as ProductGroup);
}
