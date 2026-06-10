import { describe, it, expect } from "vitest";
import {
  resolveSelfConsistencySamples,
  resolveSelfConsistencyTemperature,
  DEFAULT_SELF_CONSISTENCY_TEMPERATURE,
} from "./config";
describe("resolveSelfConsistencySamples", () => {
  it("defaults to 3 and honors a valid override; floors to >=1 on junk", () => {
    expect(resolveSelfConsistencySamples({})).toBe(3);
    expect(resolveSelfConsistencySamples({ SELF_CONSISTENCY_SAMPLES: "5" })).toBe(5);
    expect(resolveSelfConsistencySamples({ SELF_CONSISTENCY_SAMPLES: "0" })).toBe(3);
    expect(resolveSelfConsistencySamples({ SELF_CONSISTENCY_SAMPLES: "nope" })).toBe(3);
  });
});

describe("resolveSelfConsistencyTemperature", () => {
  it("defaults to a calm ~0.4 (cooler than the old hardcoded 0.7)", () => {
    expect(resolveSelfConsistencyTemperature({})).toBe(DEFAULT_SELF_CONSISTENCY_TEMPERATURE);
    expect(DEFAULT_SELF_CONSISTENCY_TEMPERATURE).toBeGreaterThan(0);
    expect(DEFAULT_SELF_CONSISTENCY_TEMPERATURE).toBeLessThan(0.7);
  });

  it("honors a valid in-range override (including 0)", () => {
    expect(resolveSelfConsistencyTemperature({ SELF_CONSISTENCY_TEMPERATURE: "0.2" })).toBeCloseTo(0.2, 5);
    expect(resolveSelfConsistencyTemperature({ SELF_CONSISTENCY_TEMPERATURE: "0" })).toBe(0);
    expect(resolveSelfConsistencyTemperature({ SELF_CONSISTENCY_TEMPERATURE: "2" })).toBe(2);
  });

  it("falls back to the default on blank, junk, or out-of-range values", () => {
    expect(resolveSelfConsistencyTemperature({ SELF_CONSISTENCY_TEMPERATURE: "" })).toBe(DEFAULT_SELF_CONSISTENCY_TEMPERATURE);
    expect(resolveSelfConsistencyTemperature({ SELF_CONSISTENCY_TEMPERATURE: "   " })).toBe(DEFAULT_SELF_CONSISTENCY_TEMPERATURE);
    expect(resolveSelfConsistencyTemperature({ SELF_CONSISTENCY_TEMPERATURE: "hot" })).toBe(DEFAULT_SELF_CONSISTENCY_TEMPERATURE);
    expect(resolveSelfConsistencyTemperature({ SELF_CONSISTENCY_TEMPERATURE: "-1" })).toBe(DEFAULT_SELF_CONSISTENCY_TEMPERATURE);
    expect(resolveSelfConsistencyTemperature({ SELF_CONSISTENCY_TEMPERATURE: "5" })).toBe(DEFAULT_SELF_CONSISTENCY_TEMPERATURE);
  });
});
