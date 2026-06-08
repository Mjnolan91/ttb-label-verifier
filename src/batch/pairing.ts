/**
 * pairing.ts — group a batch of uploaded image filenames into PRODUCTS, mirroring TTB's COLA model
 * (a product has one or more images, each a position: front/back/neck/other). Pairing is by a
 * filename convention so it's deterministic and visible to the user: a trailing position token after
 * a separator (`__`, `-`, `_`, or space) marks the position; the rest of the name is the product.
 *
 *   acme-ipa-front.jpg + acme-ipa-back.jpg  ->  product "acme-ipa" with [front, back]
 *   old-tom.jpg                              ->  product "old-tom" with [front]   (no token)
 *
 * Tokens: front|f|brand -> front, back|b -> back, neck|n -> neck, other|o -> other. Unrecognized
 * trailing words (e.g. "clean") are NOT positions — the file is a single-image product.
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
  back: "back",
  b: "back",
  neck: "neck",
  n: "neck",
  other: "other",
  o: "other",
};

function parseName(filename: string): { product: string; position: LabelPosition } {
  const stem = filename.replace(/\.[^.]+$/, "");
  const m = stem.match(/^(.*?)[\s_-]+([a-z]+)$/i);
  if (m) {
    const token = m[2].toLowerCase();
    const position = POSITION_TOKENS[token];
    if (position) {
      const product = m[1].trim();
      return { product: product || stem, position };
    }
  }
  return { product: stem, position: "front" };
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
