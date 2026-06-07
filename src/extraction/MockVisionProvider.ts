/**
 * MockVisionProvider.ts — the DEFAULT, hermetic extractor.
 *
 * It keys off the image FILENAME (never the bytes): given a filename it returns the matching
 * fixture's `extracted` block from eval/fixtures/cases.json, mapped into the domain
 * `ExtractedFields` shape. This makes the whole suite run offline with no real images and no
 * network — the project's "offline by default" invariant.
 *
 * Determinism for unreadable input is a feature, not an afterthought:
 *   - A KNOWN low-confidence fixture (e.g. `unreadable-blurry.svg`) replays its low-confidence
 *     values verbatim (every field's confidence ~0.3, prefix bold-ness undetectable = null).
 *   - An UNKNOWN/unrecognized filename returns a fixed below-threshold result with NO fabricated
 *     field values and NO synthesized verdict (all confidences 0).
 * Both are what US-008 surfaces as "re-upload a clearer photo", reproducible from the filename
 * alone. Neither ever auto-approves.
 */
import type { ExtractedFields, FieldConfidence } from "@/domain";
import type { ImageInput, VisionProvider } from "./VisionProvider";
// Imported at build time (resolveJsonModule) — no filesystem read or network at runtime.
import casesJson from "../../eval/fixtures/cases.json";

/** A single field as stored in cases.json: the read value plus the provider's confidence. */
interface RawConfidencedValue {
  value: string;
  confidence: number;
}

/** The `extracted` block shape in cases.json (what a real model would have read off the label). */
interface RawExtracted {
  brand?: RawConfidencedValue;
  classType?: RawConfidencedValue;
  alcoholContent?: RawConfidencedValue;
  netContents?: RawConfidencedValue;
  warningText?: RawConfidencedValue;
  warningPrefixIsAllCaps: boolean;
  warningPrefixIsBold: boolean | null;
}

interface RawCase {
  id: string;
  imageFilename: string;
  extracted: RawExtracted;
}

interface RawCasesFile {
  cases: RawCase[];
}

// Cast through `unknown` once: the JSON's inferred literal types are noisy; this is the schema.
const CASES = (casesJson as unknown as RawCasesFile).cases;

/** filename -> the fixture's raw `extracted` block. Built once at module load. */
const EXTRACTED_BY_FILENAME: ReadonlyMap<string, RawExtracted> = new Map(
  CASES.map((c) => [c.imageFilename, c.extracted]),
);

/** Map a fixture's raw `extracted` block into the domain `ExtractedFields` shape. */
function toExtractedFields(raw: RawExtracted): ExtractedFields {
  const confidence: FieldConfidence = {};
  if (raw.brand) confidence.brand = raw.brand.confidence;
  if (raw.classType) confidence.classType = raw.classType.confidence;
  if (raw.alcoholContent) confidence.alcoholContent = raw.alcoholContent.confidence;
  if (raw.netContents) confidence.netContents = raw.netContents.confidence;
  if (raw.warningText) confidence.warningText = raw.warningText.confidence;

  // NOTE: values (including empty strings) are passed through VERBATIM — an empty warningText at
  // HIGH confidence means "confidently absent" (US-004 fails it), distinct from the all-low
  // unreadable case below. We never coalesce "" to a fabricated value.
  return {
    brand: raw.brand?.value,
    classType: raw.classType?.value,
    alcoholContentText: raw.alcoholContent?.value,
    netContents: raw.netContents?.value,
    warningText: raw.warningText?.value,
    warningPrefixIsAllCaps: raw.warningPrefixIsAllCaps,
    warningPrefixIsBold: raw.warningPrefixIsBold,
    confidence,
  };
}

/**
 * The deterministic result for an UNKNOWN/unreadable filename: no field values (never
 * fabricated), every confidence 0 (below any approve/review threshold), prefix all-caps false
 * and bold-ness undetectable (null). This is the canonical "cannot read it" output that drives
 * the re-upload path — same every time.
 */
function unreadableResult(): ExtractedFields {
  return {
    warningPrefixIsAllCaps: false,
    warningPrefixIsBold: null,
    confidence: {
      brand: 0,
      classType: 0,
      alcoholContent: 0,
      netContents: 0,
      warningText: 0,
    },
  };
}

export class MockVisionProvider implements VisionProvider {
  readonly name = "mock" as const;

  // Not `async` (there is no I/O to await) but returns a Promise to satisfy the interface.
  extract(image: ImageInput): Promise<ExtractedFields> {
    const raw = EXTRACTED_BY_FILENAME.get(image.filename);
    return Promise.resolve(raw ? toExtractedFields(raw) : unreadableResult());
  }
}
