import { describe, it, expect } from "vitest";
import { resolveSelfConsistencySamples } from "./config";
describe("resolveSelfConsistencySamples", () => {
  it("defaults to 3 and honors a valid override; floors to >=1 on junk", () => {
    expect(resolveSelfConsistencySamples({})).toBe(3);
    expect(resolveSelfConsistencySamples({ SELF_CONSISTENCY_SAMPLES: "5" })).toBe(5);
    expect(resolveSelfConsistencySamples({ SELF_CONSISTENCY_SAMPLES: "0" })).toBe(3);
    expect(resolveSelfConsistencySamples({ SELF_CONSISTENCY_SAMPLES: "nope" })).toBe(3);
  });
});
