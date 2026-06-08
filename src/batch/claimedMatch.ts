/**
 * claimedMatch.ts — resolve the application's claimed values for a batch product.
 *
 * The claimed-values CSV (parseClaimedCsv) is keyed by a free-form `filename`; a product groups one or
 * more image files (pairing.ts). To connect them, we try each of the product's image filenames, then
 * the product stem, all case-insensitively. Pure and deterministic — no I/O.
 */
import type { ProductGroup } from "./pairing";
import type { ClaimedRow } from "./csv";

export function resolveClaimedFor(
  group: ProductGroup,
  claimed: Map<string, ClaimedRow>,
): ClaimedRow | undefined {
  if (claimed.size === 0) return undefined;
  const lower = new Map<string, ClaimedRow>();
  for (const [k, v] of claimed) lower.set(k.toLowerCase(), v);
  for (const img of group.images) {
    const hit = lower.get(img.filename.toLowerCase());
    if (hit) return hit;
  }
  return lower.get(group.product.toLowerCase());
}
