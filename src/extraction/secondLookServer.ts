/**
 * secondLookServer.ts — the SERVER half of the batch second look (see secondLook.ts for the
 * semantics and the client/server boundary rationale): the actual focused read on a provider's
 * strong model, plus its environment switch. Kept apart from secondLook.ts so the pure half stays
 * importable by client components without dragging provider machinery into the bundle graph.
 */
import { readFieldsBounded } from "./rescue";
import {
  SECOND_LOOK_CONFIDENCE,
  secondLookDescriptors,
  type SecondLookFindings,
  type SecondLookKey,
} from "./secondLook";
import type { ImageInput, VisionProvider } from "./VisionProvider";

/** Whether the second-look pass is enabled (SECOND_LOOK=0/false/off disables; default on). */
export function resolveSecondLook(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.SECOND_LOOK;
  return !(raw === "0" || raw === "false" || raw === "off");
}

/**
 * Run ONE bounded focused read for the given field channels. Returns the recovered values (possibly
 * empty — the strong model couldn't find them either), or null when the provider has no `readFields`
 * or the call failed/timed out entirely.
 */
export async function runSecondLook(
  provider: VisionProvider,
  images: ImageInput[],
  keys: readonly SecondLookKey[],
  timeoutMs: number,
): Promise<SecondLookFindings | null> {
  if (typeof provider.readFields !== "function" || keys.length === 0) return null;
  const descriptors = secondLookDescriptors(keys);
  const strong = await readFieldsBounded(
    provider,
    images,
    descriptors.map((d) => d.rawKey),
    timeoutMs,
  );
  if (strong === null) return null;
  const findings: SecondLookFindings = {};
  for (const d of descriptors) {
    const raw = strong[d.rawKey];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value === "") continue; // not legible to the strong model either: still missing, honestly
    findings[d.confKey] = { value, confidence: SECOND_LOOK_CONFIDENCE };
  }
  return findings;
}
