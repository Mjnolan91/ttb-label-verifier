/**
 * Trivial scaffold smoke test: proves the Vitest runner is wired up and the
 * app's single source of truth for its title is correct. Runs in the node environment
 * with no DOM and no network.
 */
import { describe, it, expect } from "vitest";
import { APP_TITLE } from "./constants";

describe("app scaffold", () => {
  it("exposes the application title", () => {
    expect(APP_TITLE).toBe("TTB Label Verifier");
  });
});
