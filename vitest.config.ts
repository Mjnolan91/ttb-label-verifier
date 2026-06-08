import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Vitest config for the TTB Label Verifier.
 *
 * The whole suite is hermetic and offline: the default extractor is the mock provider
 * (keyed off fixture filenames), so no test touches the network. Tests live next to the
 * code under `src/` (and later `eval/`); component tests switch individual files to the
 * jsdom environment via a `// @vitest-environment jsdom` docblock. The React plugin enables
 * the automatic JSX runtime so those `.tsx` component tests transform correctly.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "eval/**/*.{test,spec}.{ts,tsx}",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
