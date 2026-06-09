/**
 * fieldCatalog.test.ts — guards the single-source-of-truth invariants the plumbing relies on.
 */
import { describe, it, expect } from "vitest";
import { FIELD_CATALOG, HEADLINE_FIELDS, DETAIL_FIELDS } from "./fieldCatalog";
import { SYSTEM_PROMPT } from "./LlmVisionProvider";

describe("brand allocation guidance (producer-is-the-brand / acronym-of-producer)", () => {
  // The model must NOT take a masthead acronym ("ABC") as the brand when it's a shortening of the
  // producer ("ABC Distillery"); per TTB the full producer name is the brand. Lock the prompt guidance.
  const brand = FIELD_CATALOG.find((d) => d.key === "brand")!.description;

  it("teaches the acronym/shortening-of-producer rule and gives the full-producer answer", () => {
    expect(brand.toLowerCase()).toMatch(/acronym|initials|shortening/);
    expect(brand).toContain("ABC Distillery");
  });

  it("no longer contains the misleading brand-splitting exemplar", () => {
    expect(brand).not.toContain('brand "ABC" + producer');
  });

  it("the system prompt mirrors the rule", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/acronym|initials|shortening/);
    expect(SYSTEM_PROMPT).toContain("ABC Distillery");
  });
});

describe("FIELD_CATALOG", () => {
  it("has unique keys, rawKeys, and csvColumns", () => {
    const keys = FIELD_CATALOG.map((d) => d.key);
    const rawKeys = FIELD_CATALOG.map((d) => d.rawKey);
    const cols = FIELD_CATALOG.map((d) => d.csvColumn);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(rawKeys).size).toBe(rawKeys.length);
    expect(new Set(cols).size).toBe(cols.length);
  });

  it("only the alcohol field has a rawKey distinct from its value key", () => {
    for (const d of FIELD_CATALOG) {
      if (d.key === "alcoholContentText") expect(d.rawKey).toBe("alcoholContent");
      else expect(d.rawKey).toBe(d.key);
    }
  });

  it("partitions cleanly into headline + detail groups", () => {
    expect(HEADLINE_FIELDS.length + DETAIL_FIELDS.length).toBe(FIELD_CATALOG.length);
    expect(HEADLINE_FIELDS.every((d) => d.group === "headline")).toBe(true);
    expect(DETAIL_FIELDS.every((d) => d.group === "detail")).toBe(true);
    // The headline set is the at-a-glance fields an agent reads first.
    expect(HEADLINE_FIELDS.map((d) => d.key)).toEqual([
      "brand",
      "classType",
      "alcoholContentText",
      "netContents",
      "warningText",
    ]);
  });
});
