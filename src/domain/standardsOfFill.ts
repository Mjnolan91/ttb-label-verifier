/**
 * standardsOfFill.ts — TTB authorized container sizes (statutory; CFR-verified).
 *
 * CFR-VERIFIED MODULE (extends the domain; see ./README.md). Sizes are in MILLILITERS.
 *  - Distilled spirits: 27 CFR 5.203 — a CLOSED enumeration of 25 metric sizes.
 *  - Wine: 27 CFR 4.72 — a CLOSED enumeration of 25 metric sizes, PLUS any container of 4 L or more
 *    filled in EVEN-LITER quantities (4 L, 5 L, 6 L, …).
 *  - Malt beverages: 27 CFR Part 7 has NO standard of fill — any container size is lawful, the only
 *    constraint is the US-customary net-contents STATEMENT (27 CFR 7.70). So there is deliberately
 *    NO malt list here.
 *
 * Lists current as of the "Standards of Fill for Wine and Distilled Spirits" FINAL RULE effective
 * January 10, 2025 (FR 2025-00271), which ADDED 15 distilled-spirits sizes and 13 wine sizes and
 * removed the spirits can/non-can distinction — so 700 mL and 750 mL (etc.) are now co-authorized for
 * spirits. (This supersedes the earlier 2020 T.D. TTB-158 enumeration.) TTB periodically ADDS sizes,
 * so a stated size that is NOT in these lists is surfaced for human REVIEW (a newer authorized size
 * can be cleared by a person), never hard-failed — this stays conservative without wrongly rejecting
 * a lawful new size. Treat as statutory: extend, never retune to pass a test.
 */

/** 27 CFR 5.203 — distilled-spirits authorized fills (mL). */
export const SPIRITS_STANDARDS_OF_FILL_ML: readonly number[] = [
  50, 100, 187, 200, 250, 331, 350, 355, 375, 475, 500, 570, 700, 710, 720, 750, 900, 945,
  1000, 1500, 1750, 1800, 2000, 3000, 3750,
];

/** 27 CFR 4.72 — wine authorized fills (mL); plus any even-liter container ≥ 4 L (see isAuthorizedFill). */
export const WINE_STANDARDS_OF_FILL_ML: readonly number[] = [
  50, 100, 180, 187, 200, 250, 300, 330, 355, 360, 375, 473, 500, 550, 568, 600, 620, 700, 720, 750,
  1000, 1500, 1800, 2250, 3000,
];

export interface ParsedNetContents {
  /** Stated metric volume in mL (liters converted), when a metric quantity is present. */
  ml?: number;
  /** Stated US-customary volume in FLUID OUNCES (pints/quarts/gallons converted, combination
   *  statements like "1 PT 8 FL OZ" summed), when a customary quantity is present. Lets the
   *  comparator see "1 PINT" and "16 FL OZ" as the same quantity instead of failing on text. */
  flOz?: number;
  /** Whether a US-customary volume (fl oz / pint / quart / gallon) is stated. */
  hasUsCustomary: boolean;
  /** Whether any recognizable quantity+unit was found at all. */
  parsed: boolean;
}

/**
 * Parse a net-contents statement into the quantities we can validate. Tolerant of casing/spacing.
 * Pure; no standards applied here (that is isAuthorizedFill + the per-class comparator check).
 */
export function parseNetContents(text: string | undefined): ParsedNetContents {
  if (!text) return { hasUsCustomary: false, parsed: false };
  const t = text.toLowerCase();

  // The number form accepts a leading decimal: ".75 L" must read as 0.75, not skip the dot and
  // read "75 L" (a 100x misparse that confidently hard-failed a plausible application typing).
  let ml: number | undefined;
  const mlMatch = t.match(/(\d+(?:\.\d+)?|\.\d+)\s*ml\b/); // "750 ml" / "750ml"
  const clMatch = t.match(/(\d+(?:\.\d+)?|\.\d+)\s*cl\b/); // "75 cl" — standard on European labels
  if (mlMatch) {
    ml = parseFloat(mlMatch[1]);
  } else if (clMatch) {
    ml = parseFloat(clMatch[1]) * 10;
  } else {
    const lMatch = t.match(/(\d+(?:\.\d+)?|\.\d+)\s*(?:l\b|lit(?:er|re)s?\b)/); // "1.5 l" / "1 liter"
    if (lMatch) ml = parseFloat(lMatch[1]) * 1000;
  }

  // Customary quantities parse into FLUID OUNCES, summing combination statements ("1 PT 8 FL OZ"
  // = 24). Bare "oz" counts as fluid ounces: on a beverage label there is no other ounce.
  const ozM = t.match(/(\d+(?:\.\d+)?|\.\d+)\s*(?:fl\.?\s*oz|fluid\s*ounces?|oz)\b/);
  const ptM = t.match(/(\d+(?:\.\d+)?|\.\d+)\s*(?:pints?|pt)\b/);
  const qtM = t.match(/(\d+(?:\.\d+)?|\.\d+)\s*(?:quarts?|qt)\b/);
  const galM = t.match(/(\d+(?:\.\d+)?|\.\d+)\s*(?:gallons?|gal)\b/);
  let flOz: number | undefined;
  if (ozM || ptM || qtM || galM) {
    flOz =
      (ozM ? parseFloat(ozM[1]) : 0) +
      (ptM ? parseFloat(ptM[1]) * 16 : 0) +
      (qtM ? parseFloat(qtM[1]) * 32 : 0) +
      (galM ? parseFloat(galM[1]) * 128 : 0);
  }
  const hasUsCustomary = flOz !== undefined;

  return { ml, flOz, hasUsCustomary, parsed: ml !== undefined || hasUsCustomary };
}

/** Is a stated metric volume (mL) an authorized standard of fill? Wine also allows even-liter ≥ 4 L. */
export function isAuthorizedFill(ml: number, kind: "spirits" | "wine"): boolean {
  const list = kind === "spirits" ? SPIRITS_STANDARDS_OF_FILL_ML : WINE_STANDARDS_OF_FILL_ML;
  if (list.some((s) => Math.abs(s - ml) < 0.5)) return true;
  // Wine: containers of 4 L or larger are lawful when filled in whole-liter increments (27 CFR 4.72(b)).
  if (kind === "wine" && ml >= 4000 && Math.abs(ml % 1000) < 0.5) return true;
  return false;
}
