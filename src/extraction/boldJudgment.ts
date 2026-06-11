/**
 * boldJudgment.ts — how the dedicated "is the GOVERNMENT WARNING prefix BOLD?" judgment is made robust.
 *
 * Bold is a real CFR requirement (27 CFR 16.22(a)(2)) and a CONFIDENTLY not-bold prefix HARD-FAILS the
 * warning check (compareWarning / completeness). That makes a false "not bold" the worst outcome here: a
 * single visual-weight judgment from a downscaled JPEG could reject a compliant label. Two pure guards,
 * unit-tested, keep that from happening:
 *
 *  - aggregateBoldVotes: the bold pass is sampled N times (self-consistency, like extraction); a MAJORITY
 *    is required before asserting true/false, and a tie (including all-undetectable) falls to null.
 *  - combineBoldSignals: the sampled judge is COMBINED with the extraction model's own bold flag instead
 *    of clobbering it; "not bold" (the hard-fail signal) is asserted ONLY when both agree, and any
 *    disagreement or lone "not bold" falls to null (surfaced for a human, never hard-failed).
 *
 * Tri-state throughout: true = bold, false = not bold (hard-fail signal), null = cannot assert.
 * A null is NOT a silent pass: compareWarning routes an unverified prefix to review, so "we could
 * not check" is always surfaced to the reviewer rather than reading as "we checked and it's fine".
 */

/** Majority vote over N tri-state bold samples; a tie (incl. all-null) is "cannot assert" (null). */
export function aggregateBoldVotes(votes: readonly (boolean | null)[]): boolean | null {
  let truthy = 0;
  let falsy = 0;
  for (const v of votes) {
    if (v === true) truthy++;
    else if (v === false) falsy++;
  }
  if (falsy > truthy) return false;
  if (truthy > falsy) return true;
  return null;
}

/**
 * Combine the dedicated bold judge with the extraction model's own bold flag. Assert "not bold" (false,
 * the hard-fail signal) ONLY when BOTH signals agree; a lone "not bold" or any disagreement falls to null
 * (surfaced, not failed), so one weak signal can't reject a compliant label. "Bold" (true) needs only one
 * positive with no contradicting "not bold".
 */
export function combineBoldSignals(extraction: boolean | null, judge: boolean | null): boolean | null {
  if (extraction === false && judge === false) return false; // both agree it's not bold -> hard-fail justified
  if (extraction === false || judge === false) return null; // one says not-bold, the other doesn't agree
  if (extraction === true || judge === true) return true; // positive evidence, nothing contradicting
  return null; // neither can tell
}

/**
 * The MIRROR of combineBoldSignals for flags where TRUE is the hard-fail signal (e.g.
 * warningRemainderIsBold: a confidently-bold remainder violates 16.22(a)(2)). Assert the violation
 * (true) ONLY when both signals agree; a lone "violation" or any disagreement falls to null
 * (surfaced, not failed); "compliant" (false) needs only one positive with no contradiction.
 */
export function combineViolationSignals(a: boolean | null, b: boolean | null): boolean | null {
  if (a === true && b === true) return true; // both agree on the violation -> hard-fail justified
  if (a === true || b === true) return null; // one sees a violation, the other doesn't agree
  if (a === false || b === false) return false; // compliant evidence, nothing contradicting
  return null; // neither can tell
}
