/**
 * labelReview.test.ts — the shared review derivation used by BOTH the single screen and the batch
 * worklist. Locks the load-bearing behavior: a completeness-gated "review" settles to approve/reject
 * from the reviewer's overrides, the gated-but-matched field surfaces a concern, and the email notes
 * reflect the tool status.
 */
import { describe, expect, it } from "vitest";
import { combinedVerdict } from "@/compare";
import { CANONICAL_GOVERNMENT_WARNING, type ClaimedFields, type ExtractedFields } from "@/domain";
import { deriveLabelReview, capVerdictForPartialRead } from "./labelReview";

describe("capVerdictForPartialRead", () => {
  it("caps approve to review when an image dropped out of the read; never relaxes review/reject", () => {
    // The unread image could contradict anything the surviving images showed — an approve on
    // partial evidence is the false-approval class this project refuses to ship.
    expect(capVerdictForPartialRead("approve", true)).toBe("review");
    expect(capVerdictForPartialRead("review", true)).toBe("review");
    expect(capVerdictForPartialRead("reject", true)).toBe("reject");
    expect(capVerdictForPartialRead("approve", false)).toBe("approve");
    expect(capVerdictForPartialRead(null, true)).toBeNull();
    expect(capVerdictForPartialRead(undefined, true)).toBeUndefined();
  });
});

// A bourbon whose net contents (740 mL) MATCH the application but are not an authorized standard of
// fill — so the comparison passes while completeness flags it: the screenshot's gated-review case.
const extracted: ExtractedFields = {
  brand: "Old Tom Distillery",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContentText: "45% Alc./Vol. (90 Proof)",
  netContents: "740 mL",
  name: "Old Tom Distillery",
  address: "Louisville, KY",
  warningText: CANONICAL_GOVERNMENT_WARNING,
  warningPrefixIsAllCaps: true,
  warningPrefixIsBold: true,
  confidence: {
    brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96, name: 0.95, address: 0.95, warningText: 0.96,
  },
};
const claimed: ClaimedFields = {
  brand: "Old Tom Distillery",
  alcoholContentText: "45% Alc./Vol. (90 Proof)",
  classType: "Kentucky Straight Bourbon Whiskey",
  netContents: "740 mL",
  name: "Old Tom Distillery",
  address: "Louisville, KY",
  beverageClass: "distilledSpirits",
};
const combined = combinedVerdict(claimed, extracted);

describe("deriveLabelReview", () => {
  it("gates a values-match-but-incomplete label to review, and surfaces the field as a concern", () => {
    const r = deriveLabelReview(combined, {});
    expect(r.effectiveOverall).toBe("review");
    expect(r.effectiveGatedByCompleteness).toBe(true);
    expect(r.completenessConcerns.netContents).toBeTruthy();
  });

  it("settles to approve when the reviewer confirms the flagged field (gate recomputes)", () => {
    const r = deriveLabelReview(combined, { netContents: "ok" });
    expect(r.effectiveOverall).toBe("approve");
    expect(r.approveNotes).toMatch(/Net contents/i);
  });

  it("settles to reject when the reviewer flags the field, and lists it in the send-back notes", () => {
    const r = deriveLabelReview(combined, { netContents: "issue" });
    expect(r.effectiveOverall).toBe("reject");
    expect(r.rejectNotes).toMatch(/Net contents/i);
    expect(r.rejectNotes).toMatch(/flagged by the reviewer/i);
  });

  it("weaves a per-field note into the send-back notes (the reviewer's words over the generic reason)", () => {
    const r = deriveLabelReview(combined, { netContents: "issue" }, { netContents: "Bottle is 750 mL; label was misread." });
    expect(r.rejectNotes).toMatch(/Bottle is 750 mL; label was misread\./);
    expect(r.rejectNotes).not.toMatch(/flagged by the reviewer/i); // the note replaces the generic line
  });

  it("weaves a per-field note into the approval notes when a field is confirmed", () => {
    const r = deriveLabelReview(combined, { netContents: "ok" }, { netContents: "740 mL is a lawful sample size here." });
    expect(r.approveNotes).toMatch(/740 mL is a lawful sample size here\./);
  });

  it("returns a null verdict (completeness-only) when there are no application values", () => {
    const completenessOnly = combinedVerdict(null, extracted);
    const r = deriveLabelReview(completenessOnly, {});
    expect(r.effectiveOverall).toBeNull();
  });

  // The adversarially-found false-approval vector (2026-06-11): the application claims only what
  // the batch gate needs (brand + alcohol), every COMPARED field matches, and a mandatory element
  // the application never claimed (net contents) is present only at LOW read confidence — e.g. a
  // presence-instability read or a batch second-look recovery at 0.65. Nothing compares it, so
  // only the completeness gate can hold it; gating on "incomplete" alone released it to Approve.
  it("holds the verdict at review when an UNCLAIMED mandatory element is present at low confidence", () => {
    const lowConfNet: ExtractedFields = {
      ...extracted,
      netContents: "750 mL", // authorized size — present and well-formed, just not trusted
      confidence: { ...extracted.confidence, netContents: 0.65 },
    };
    const brandOnlyClaim: ClaimedFields = {
      brand: "Old Tom Distillery",
      alcoholContentText: "45% Alc./Vol. (90 Proof)",
      beverageClass: "distilledSpirits",
    };
    const c = combinedVerdict(brandOnlyClaim, lowConfNet);
    const r = deriveLabelReview(c, {});
    expect(r.effectiveOverall).toBe("review"); // never approve over an unvouched-for element
    expect(r.effectiveGatedByCompleteness).toBe(true);
    // The derivation must never be MORE LENIENT than the raw combine.
    expect(r.effectiveOverall).toBe(c.overall);
    // Confirming the element (the card/drawer "ok") still clears the gate — not stranded.
    const confirmed = deriveLabelReview(c, { netContents: "ok" });
    expect(confirmed.effectiveOverall).toBe("approve");
  });
});
