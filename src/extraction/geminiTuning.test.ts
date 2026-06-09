import { describe, it, expect } from "vitest";
import { geminiTuning, isGemini3 } from "./geminiTuning";

describe("isGemini3", () => {
  it("treats gemini-3* ids (and unknown ids) as gen3, older ids as not", () => {
    expect(isGemini3("gemini-3.1-pro-preview")).toBe(true);
    expect(isGemini3("gemini-3.5-flash")).toBe(true);
    expect(isGemini3("something-unknown")).toBe(true); // conservative default = current line
    expect(isGemini3("gemini-2.0-flash")).toBe(false);
    expect(isGemini3("gemini-1.5-pro")).toBe(false);
  });
});

describe("geminiTuning — Gemini 3", () => {
  const M = "gemini-3.1-pro-preview";
  it("read mode: temp 1.0, thinkingLevel low (NOT 'minimal' — Pro rejects it), no thinkingBudget", () => {
    const t = geminiTuning(M, "read");
    expect(t.temperature).toBe(1);
    expect(t.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });
  it("sample mode: temp 1.0 (variance is inherent at the gen3 default)", () => {
    expect(geminiTuning(M, "sample").temperature).toBe(1);
  });
  it("bold mode: thinkingLevel high", () => {
    const t = geminiTuning(M, "bold");
    expect(t.thinkingConfig).toEqual({ thinkingLevel: "high" });
  });
});

describe("geminiTuning — legacy 2.x", () => {
  const M = "gemini-2.0-flash";
  it("read: temp 0 + thinkingBudget 0", () => {
    const t = geminiTuning(M, "read");
    expect(t.temperature).toBe(0);
    expect(t.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
  it("sample: temp 0.7 to create variance for self-consistency", () => {
    expect(geminiTuning(M, "sample").temperature).toBe(0.7);
  });
  it("bold: thinkingBudget 2048", () => {
    expect(geminiTuning(M, "bold").thinkingConfig).toEqual({ thinkingBudget: 2048 });
  });
});
