/**
 * extraction/index.ts — public surface + provider selection.
 *
 * `getVisionProvider()` resolves the active provider from the `VISION_PROVIDER` env var,
 * defaulting to the offline `mock`. The real Azure providers are added later (llm: US-009,
 * ocr: US-010); until then selecting them errors CLEANLY and synchronously — it never makes a
 * network call, and never affects the default/test path (which stays mock).
 */
export type { ImageInput, VisionProvider, VisionProviderName } from "./VisionProvider";
export { MockVisionProvider } from "./MockVisionProvider";

import type { VisionProvider } from "./VisionProvider";
import { MockVisionProvider } from "./MockVisionProvider";

/**
 * Resolve the configured vision provider.
 * @param name optional explicit provider name; defaults to `process.env.VISION_PROVIDER`, then `mock`.
 * @throws if a real provider is selected before it is wired in, or the name is unknown. The mock
 *         path never throws and never touches the network.
 */
export function getVisionProvider(name?: string): VisionProvider {
  const selected = (name ?? process.env.VISION_PROVIDER ?? "mock").toLowerCase();
  switch (selected) {
    case "mock":
      return new MockVisionProvider();
    case "llm":
      throw new Error(
        "VISION_PROVIDER=llm (Azure OpenAI) is not available yet — added in US-009. " +
          "The default 'mock' provider runs fully offline with no keys.",
      );
    case "ocr":
      throw new Error(
        "VISION_PROVIDER=ocr (Azure AI Document Intelligence) is not available yet — added in US-010. " +
          "The default 'mock' provider runs fully offline with no keys.",
      );
    default:
      throw new Error(
        `Unknown VISION_PROVIDER='${selected}'. Use one of: mock|llm|ocr (default: mock).`,
      );
  }
}
