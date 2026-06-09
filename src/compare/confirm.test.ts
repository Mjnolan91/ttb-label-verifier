import { describe, it, expect } from "vitest";
import { confirmVerdict } from "./confirm";
import { CANONICAL_GOVERNMENT_WARNING, type ExtractedFields } from "@/domain";

/** A clean, high-confidence spirits extraction with every mandatory element present. */
function spirits(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brand: "Old Tom Distillery",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContentText: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    name: "Old Tom Distillery",
    address: "Louisville, KY",
    warningText: CANONICAL_GOVERNMENT_WARNING,
    warningPrefixIsAllCaps: true,
    warningPrefixIsBold: true,
    confidence: {
      brand: 0.98, classType: 0.97, alcoholContent: 0.98, netContents: 0.96,
      name: 0.95, address: 0.95, warningText: 0.96,
    },
    ...overrides,
  };
}

describe("confirmVerdict — pre-confirmed high-confidence labels", () => {
  it("a clean high-confidence label needs no confirmation and the suggested verdict is approve", () => {
    const v = confirmVerdict(spirits(), {});
    expect(v.awaitingConfirmation).toBe(false);
    expect(v.overall).toBe("approve");
    const brand = v.fields.find((f) => f.key === "brand")!;
    expect(brand.status).toBe("pass");
    expect(brand.needsConfirmation).toBe(false);
  });

  it("conditional absent elements never block (AC-2)", () => {
    const v = confirmVerdict(spirits(), {});
    const age = v.fields.find((f) => f.key === "ageStatement");
    expect(age).toBeDefined();
    expect(age!.necessity).toBe("conditional");
    expect(age!.needsConfirmation).toBe(false);
  });
});

describe("confirmVerdict — low-confidence reads flag for confirmation", () => {
  it("a low-confidence brand is flagged + blocks approve until accepted, then passes", () => {
    const e = spirits({ confidence: { ...spirits().confidence, brand: 0.4 } });
    const before = confirmVerdict(e, {});
    const brand = before.fields.find((f) => f.key === "brand")!;
    expect(brand.flagged).toBe(true);
    expect(brand.needsConfirmation).toBe(true);
    expect(before.awaitingConfirmation).toBe(true);
    expect(before.overall).toBe("review");

    const after = confirmVerdict(e, { brand: { state: "accepted" } });
    const brandAfter = after.fields.find((f) => f.key === "brand")!;
    expect(brandAfter.status).toBe("pass");
    expect(after.awaitingConfirmation).toBe(false);
    expect(after.overall).toBe("approve");
  });
});

describe("confirmVerdict — missing mandatory fields", () => {
  it("an absent mandatory field is a flagged review until resolved", () => {
    const e = spirits({ netContents: undefined, confidence: { ...spirits().confidence, netContents: undefined } });
    const v = confirmVerdict(e, {});
    const net = v.fields.find((f) => f.key === "netContents")!;
    expect(net.status).toBe("review");
    expect(net.needsConfirmation).toBe(true);
    expect(v.awaitingConfirmation).toBe(true);
  });

  it("confirming an absent mandatory field as missing escalates to reject", () => {
    const e = spirits({ netContents: undefined });
    const v = confirmVerdict(e, { netContents: { state: "missing" } });
    const net = v.fields.find((f) => f.key === "netContents")!;
    expect(net.status).toBe("fail");
    expect(net.needsConfirmation).toBe(false);
    expect(v.overall).toBe("reject");
  });

  it("entering a value for an absent mandatory field resolves it to pass", () => {
    const e = spirits({ netContents: undefined });
    const v = confirmVerdict(e, { netContents: { state: "edited", editedValue: "750 mL" } });
    const net = v.fields.find((f) => f.key === "netContents")!;
    expect(net.status).toBe("pass");
    expect(v.awaitingConfirmation).toBe(false);
  });

  it("accepting an absent mandatory field (nothing to confirm) escalates to reject", () => {
    const e = spirits({ netContents: undefined });
    const v = confirmVerdict(e, { netContents: { state: "accepted" } });
    const net = v.fields.find((f) => f.key === "netContents")!;
    expect(net.status).toBe("fail");
    expect(net.needsConfirmation).toBe(false);
    expect(v.overall).toBe("reject");
  });
});

describe("confirmVerdict — edits re-run the field comparator", () => {
  it("a hard ABV mismatch on edit fails the field (reject)", () => {
    const e = spirits();
    const v = confirmVerdict(e, { alcoholContent: { state: "edited", editedValue: "60% Alc./Vol." } });
    const alc = v.fields.find((f) => f.key === "alcoholContent")!;
    expect(alc.status).toBe("fail");
    expect(v.overall).toBe("reject");
  });

  it("a close-but-different brand edit is review, not fail", () => {
    const e = spirits();
    const v = confirmVerdict(e, { brand: { state: "edited", editedValue: "Old Tom Distillary" } });
    const brand = v.fields.find((f) => f.key === "brand")!;
    expect(brand.status).toBe("review");
    expect(v.overall).toBe("review");
  });

  it("editing a low-confidence present field re-runs the comparator (match -> pass)", () => {
    const e = spirits({ confidence: { ...spirits().confidence, netContents: 0.4 } });
    const v = confirmVerdict(e, { netContents: { state: "edited", editedValue: "750 mL" } });
    const net = v.fields.find((f) => f.key === "netContents")!;
    expect(net.status).toBe("pass");
  });
});

describe("confirmVerdict — the government warning is auto-evaluated, never free-text", () => {
  it("a title-case (not all-caps) warning prefix fails (reject), not confirmable", () => {
    const e = spirits({ warningPrefixIsAllCaps: false });
    const v = confirmVerdict(e, {});
    const w = v.fields.find((f) => f.key === "governmentWarning")!;
    expect(w.editable).toBe(false);
    expect(w.status).toBe("fail");
    expect(v.overall).toBe("reject");
  });

  it("an undetectable-all-caps (null) prefix is a flagged review the human can accept", () => {
    const before = confirmVerdict(spirits({ warningPrefixIsAllCaps: null }), {});
    const w = before.fields.find((f) => f.key === "governmentWarning")!;
    expect(w.status).toBe("review");
    expect(w.needsConfirmation).toBe(true);
    const after = confirmVerdict(spirits({ warningPrefixIsAllCaps: null }), { governmentWarning: { state: "accepted" } });
    expect(after.fields.find((f) => f.key === "governmentWarning")!.status).toBe("pass");
  });

  it("an undetectable-bold warning is a flagged review the human can accept to pass", () => {
    const e = spirits({ warningPrefixIsBold: null });
    const before = confirmVerdict(e, {});
    const w = before.fields.find((f) => f.key === "governmentWarning")!;
    expect(w.status).toBe("review");
    expect(w.needsConfirmation).toBe(true);
    const after = confirmVerdict(e, { governmentWarning: { state: "accepted" } });
    expect(after.fields.find((f) => f.key === "governmentWarning")!.status).toBe("pass");
    expect(after.awaitingConfirmation).toBe(false);
  });
});

describe("confirmVerdict — label-internal alcohol consistency", () => {
  it("an impossible ABV/proof (proof != 2xABV) is review, not pass — even unconfirmed", () => {
    const v = confirmVerdict(spirits({ alcoholContentText: "45% Alc./Vol. (80 Proof)" }), {});
    const alc = v.fields.find((f) => f.key === "alcoholContent")!;
    expect(alc.status).toBe("review");
    expect(alc.flagged).toBe(true);
    expect(v.overall).toBe("review");
  });

  it("accepting an internally-inconsistent ABV/proof still cannot approve it", () => {
    const v = confirmVerdict(spirits({ alcoholContentText: "45% Alc./Vol. (80 Proof)" }), { alcoholContent: { state: "accepted" } });
    expect(v.fields.find((f) => f.key === "alcoholContent")!.status).toBe("review");
    expect(v.overall).toBe("review");
  });
});

describe("confirmVerdict — classOverride drives the required set (Thread B)", () => {
  it("defaults to the AI-resolved class (bourbon -> distilled spirits: age in, appellation out)", () => {
    const v = confirmVerdict(spirits(), {});
    expect(v.beverageClass).toBe("distilledSpirits");
    expect(v.fields.some((f) => f.key === "ageStatement")).toBe(true);
    expect(v.fields.some((f) => f.key === "appellation")).toBe(false);
  });

  it("overriding to wine recomputes the set: appellation + sulfites in, age out", () => {
    // 45% ABV + wine override -> wine > 14%
    const v = confirmVerdict(spirits(), {}, "wine");
    expect(v.beverageClass).toBe("wineOver14");
    expect(v.fields.some((f) => f.key === "appellation")).toBe(true);
    expect(v.fields.some((f) => f.key === "sulfiteDeclaration")).toBe(true);
    expect(v.fields.some((f) => f.key === "ageStatement")).toBe(false);
  });

  it("wine override + ABV picks the tax-class tier (<=14 vs >14)", () => {
    expect(confirmVerdict(spirits({ alcoholContentText: "12% Alc./Vol." }), {}, "wine").beverageClass).toBe("wineUnder14");
    expect(confirmVerdict(spirits({ alcoholContentText: "16% Alc./Vol." }), {}, "wine").beverageClass).toBe("wineOver14");
  });

  it("overriding to malt makes the alcohol statement conditional (optional)", () => {
    const v = confirmVerdict(spirits(), {}, "maltBeverage");
    expect(v.beverageClass).toBe("maltBeverage");
    expect(v.fields.find((f) => f.key === "alcoholContent")!.necessity).toBe("conditional");
  });

  it("'unknown' (Other / not sure) yields the conservative set with mandatory alcohol content", () => {
    const v = confirmVerdict(spirits(), {}, "unknown");
    expect(v.beverageClass).toBe("unknown");
    expect(v.fields.find((f) => f.key === "alcoholContent")!.necessity).toBe("mandatory");
  });

  it("confirmations are honored under an overridden class (keyed by field, not class)", () => {
    const e = spirits({ confidence: { ...spirits().confidence, brand: 0.4 } });
    const v = confirmVerdict(e, { brand: { state: "accepted" } }, "wine");
    expect(v.fields.find((f) => f.key === "brand")!.status).toBe("pass");
  });
});
