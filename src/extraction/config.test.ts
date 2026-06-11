import { describe, it, expect } from "vitest";
import {
  resolveSelfConsistencySamples,
  resolveSelfConsistencyTemperature,
  resolveWarningJudgeSamples,
  resolveRescueTimeoutMs,
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

describe("resolveWarningJudgeSamples", () => {
  it("caps the bold-judge fan-out at 3 by default (a boolean vote needs no 7-way burst)", () => {
    expect(resolveWarningJudgeSamples(7, {})).toBe(3);
    expect(resolveWarningJudgeSamples(5, {})).toBe(3);
    expect(resolveWarningJudgeSamples(2, {})).toBe(2);
    expect(resolveWarningJudgeSamples(1, {})).toBe(1);
  });

  it("honors WARNING_JUDGE_SAMPLES, truly clamped to [1, samples] (0 means 1, not the default)", () => {
    expect(resolveWarningJudgeSamples(5, { WARNING_JUDGE_SAMPLES: "5" })).toBe(5);
    expect(resolveWarningJudgeSamples(5, { WARNING_JUDGE_SAMPLES: "9" })).toBe(5);
    expect(resolveWarningJudgeSamples(5, { WARNING_JUDGE_SAMPLES: "1" })).toBe(1);
    expect(resolveWarningJudgeSamples(5, { WARNING_JUDGE_SAMPLES: "junk" })).toBe(3);
    // An operator setting 0 wants the MINIMUM strong-model burst; surprising them with 3 calls
    // defeats the knob's purpose. Numeric low values clamp to 1; only junk falls back to default.
    expect(resolveWarningJudgeSamples(5, { WARNING_JUDGE_SAMPLES: "0" })).toBe(1);
    expect(resolveWarningJudgeSamples(5, { WARNING_JUDGE_SAMPLES: "-2" })).toBe(1);
  });
});

describe("resolveRescueTimeoutMs", () => {
  it("gives the strong-model rescue its own floor (10s) so a tight straggler cap cannot starve it", () => {
    expect(resolveRescueTimeoutMs(5000, {})).toBe(10_000);
    expect(resolveRescueTimeoutMs(8000, {})).toBe(10_000);
    expect(resolveRescueTimeoutMs(15_000, {})).toBe(15_000);
  });

  it("honors RESCUE_TIMEOUT_MS clamped to [1s, 30s] (the route's maxDuration must contain it); junk falls back to the floor", () => {
    expect(resolveRescueTimeoutMs(5000, { RESCUE_TIMEOUT_MS: "12000" })).toBe(12_000);
    expect(resolveRescueTimeoutMs(5000, { RESCUE_TIMEOUT_MS: "50" })).toBe(1_000);
    expect(resolveRescueTimeoutMs(5000, { RESCUE_TIMEOUT_MS: "999999" })).toBe(30_000);
    expect(resolveRescueTimeoutMs(5000, { RESCUE_TIMEOUT_MS: "junk" })).toBe(10_000);
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
