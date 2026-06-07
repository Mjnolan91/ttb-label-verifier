/**
 * alcohol.test.ts — proof<->ABV round-trip and the <0.5% warning-exemption boundary.
 */

import { describe, it, expect } from "vitest";
import {
  proofToAbv,
  abvToProof,
  isWarningRequired,
  WARNING_REQUIRED_ABV_THRESHOLD,
} from "./alcohol";

describe("proof <-> ABV helpers (proof = 2 x ABV)", () => {
  it("abvToProof doubles the ABV", () => {
    expect(abvToProof(40)).toBe(80);
    expect(abvToProof(45)).toBe(90); // "45% Alc./Vol. (90 Proof)"
    expect(abvToProof(0)).toBe(0);
  });

  it("proofToAbv halves the proof", () => {
    expect(proofToAbv(80)).toBe(40);
    expect(proofToAbv(90)).toBe(45);
    expect(proofToAbv(0)).toBe(0);
  });

  it("round-trips ABV -> proof -> ABV for representative values", () => {
    for (const abv of [0, 5, 13.5, 40, 45, 60, 75.5]) {
      expect(proofToAbv(abvToProof(abv))).toBeCloseTo(abv, 10);
    }
  });

  it("round-trips proof -> ABV -> proof for representative values", () => {
    for (const proof of [0, 80, 90, 100, 151]) {
      expect(abvToProof(proofToAbv(proof))).toBeCloseTo(proof, 10);
    }
  });
});

describe("isWarningRequired — 27 CFR 16.10 0.5% ABV exemption boundary", () => {
  it("exposes the threshold as 0.5", () => {
    expect(WARNING_REQUIRED_ABV_THRESHOLD).toBe(0.5);
  });

  it("is EXEMPT below 0.5% ABV (0.4 -> false)", () => {
    expect(isWarningRequired(0.4)).toBe(false);
  });

  it("is REQUIRED at exactly 0.5% ABV (0.5 -> true; 'not less than 0.5%')", () => {
    expect(isWarningRequired(0.5)).toBe(true);
  });

  it("is REQUIRED above 0.5% ABV (0.6 -> true)", () => {
    expect(isWarningRequired(0.6)).toBe(true);
  });

  it("is required for typical beverage strengths", () => {
    expect(isWarningRequired(5)).toBe(true);
    expect(isWarningRequired(13.5)).toBe(true);
    expect(isWarningRequired(40)).toBe(true);
  });
});
