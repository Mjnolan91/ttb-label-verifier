/**
 * samples.test.ts — the in-app sample downloads (public/samples, linked from the verify screen)
 * must stay byte-identical to the eval fixtures of the same name: the mock keys off the FILENAME,
 * so a drifted copy would demo one thing offline and show another to a live provider. Regenerate
 * both with `node scripts/make-fear-the-dragon-demo.cjs` (it writes the two directories together).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SAMPLE_FILENAMES = [
  "fear-the-dragon-front.jpg",
  "fear-the-dragon-back.jpg",
  "fear-the-dragon-warning-not-bold-back.jpg",
];

describe("public/samples stays in lockstep with the eval fixtures", () => {
  for (const name of SAMPLE_FILENAMES) {
    it(`${name} is byte-identical in both locations`, () => {
      const served = readFileSync(path.join("public", "samples", name));
      const fixture = readFileSync(path.join("eval", "fixtures", "images", name));
      expect(served.equals(fixture)).toBe(true);
    });
  }
});
