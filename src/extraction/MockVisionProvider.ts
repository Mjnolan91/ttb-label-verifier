/**
 * MockVisionProvider.ts — the DEFAULT, hermetic extractor.
 *
 * It keys off the image FILENAME (never the bytes): given a filename it returns the matching
 * fixture's `extracted` block from eval/fixtures/cases.json, mapped into the domain
 * `ExtractedFields` shape. The whole suite runs offline with no real images and no network.
 *
 * Determinism for unreadable input is a feature:
 *   - A KNOWN low-confidence fixture (e.g. `unreadable-blurry.svg`) replays its low-confidence
 *     values verbatim (every field's confidence ~0.3, prefix bold-ness undetectable = null).
 *   - An UNKNOWN/unrecognized filename returns a fixed below-threshold result with NO fabricated
 *     field values and NO synthesized verdict (all confidences 0).
 * Both drive the "re-upload a clearer photo" path. Neither ever auto-approves.
 */
import type { ExtractedFields } from "@/domain";
import type { ImageInput, VisionProvider } from "./VisionProvider";
import { mapRawExtracted, type RawExtractedFields } from "./extractedShape";
// Imported at build time (resolveJsonModule) — no filesystem read or network at runtime.
import casesJson from "../../eval/fixtures/cases.json";

interface RawCase {
  imageFilename: string;
  extracted: RawExtractedFields;
}

// Cast through `unknown` once: the JSON's inferred literal types are noisy; this is the schema.
const CASES = (casesJson as unknown as { cases: RawCase[] }).cases;

/** filename -> the fixture's raw `extracted` block. Built once at module load. */
const EXTRACTED_BY_FILENAME: ReadonlyMap<string, RawExtractedFields> = new Map(
  CASES.map((c) => [c.imageFilename, c.extracted]),
);

/**
 * The deterministic result for an UNKNOWN/unreadable filename: no field values (never fabricated),
 * every confidence 0 (below any threshold), prefix all-caps false and bold-ness undetectable.
 */
function unreadableResult(): ExtractedFields {
  return {
    warningPrefixIsAllCaps: false,
    warningPrefixIsBold: null,
    confidence: { brand: 0, classType: 0, alcoholContent: 0, netContents: 0, warningText: 0 },
  };
}

export class MockVisionProvider implements VisionProvider {
  readonly name = "mock" as const;

  // Not `async` (no I/O to await) but returns a Promise to satisfy the interface.
  extract(image: ImageInput): Promise<ExtractedFields> {
    const raw = EXTRACTED_BY_FILENAME.get(image.filename);
    return Promise.resolve(raw ? mapRawExtracted(raw) : unreadableResult());
  }
}
