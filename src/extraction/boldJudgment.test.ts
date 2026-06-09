/**
 * boldJudgment.test.ts — the two guards that keep a single weak "not bold" read from hard-rejecting a
 * compliant government warning (27 CFR 16.22(a)(2)).
 */
import { describe, it, expect } from "vitest";
import { aggregateBoldVotes, combineBoldSignals } from "./boldJudgment";

describe("aggregateBoldVotes — majority over N samples, ties -> null", () => {
  it("returns the majority verdict", () => {
    expect(aggregateBoldVotes([true, true, false])).toBe(true);
    expect(aggregateBoldVotes([false, false, true])).toBe(false);
  });
  it("a tie (incl. nulls) cannot assert -> null, so it never hard-fails", () => {
    expect(aggregateBoldVotes([true, false])).toBeNull();
    expect(aggregateBoldVotes([true, false, null])).toBeNull();
    expect(aggregateBoldVotes([null, null, null])).toBeNull();
    expect(aggregateBoldVotes([])).toBeNull();
  });
  it("a lone confident read still wins when unopposed", () => {
    expect(aggregateBoldVotes([null, null, false])).toBe(false);
    expect(aggregateBoldVotes([true, null, null])).toBe(true);
  });
});

describe("combineBoldSignals — assert NOT-bold only when both agree", () => {
  it("hard-fail signal (false) requires BOTH the extraction flag and the judge to agree", () => {
    expect(combineBoldSignals(false, false)).toBe(false);
  });
  it("a lone 'not bold' from either side falls to null (surfaced, not failed)", () => {
    expect(combineBoldSignals(false, null)).toBeNull();
    expect(combineBoldSignals(null, false)).toBeNull();
    expect(combineBoldSignals(false, true)).toBeNull(); // disagreement
    expect(combineBoldSignals(true, false)).toBeNull();
  });
  it("a positive (bold) holds with no contradicting 'not bold'", () => {
    expect(combineBoldSignals(true, true)).toBe(true);
    expect(combineBoldSignals(true, null)).toBe(true);
    expect(combineBoldSignals(null, true)).toBe(true);
  });
  it("neither can tell -> null", () => {
    expect(combineBoldSignals(null, null)).toBeNull();
  });
});
