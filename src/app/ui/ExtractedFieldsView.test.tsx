// @vitest-environment jsdom
/**
 * ExtractedFieldsView.test.tsx — locks the tri-state rendering of the 16.22 typography flags.
 * A null (undetectable) reading must NEVER render as "no": that would claim a violation reading
 * on missing evidence. "Verified" means verified, in both directions.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExtractedFieldsView } from "./ExtractedFieldsView";
import type { ExtractedFields } from "@/domain";

afterEach(cleanup);

function fields(overrides: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    brand: "Old Tom Distillery",
    warningPrefixIsAllCaps: null,
    warningPrefixIsBold: null,
    warningRemainderIsBold: null,
    warningIsReadilyLegible: null,
    confidence: { brand: 1 },
    ...overrides,
  } as ExtractedFields;
}

describe("ExtractedFieldsView — 16.22 flag chips are tri-state", () => {
  it('renders "undetectable" (not "no") when caps/bold evidence is missing', () => {
    render(<ExtractedFieldsView extracted={fields()} />);
    expect(screen.getByText("Warning prefix ALL CAPS:").parentElement?.textContent).toContain(
      "undetectable",
    );
    expect(screen.getByText("Warning prefix bold:").parentElement?.textContent).toContain(
      "undetectable",
    );
  });

  it('renders "yes" / "no" only on confirmed readings', () => {
    render(
      <ExtractedFieldsView
        extracted={fields({ warningPrefixIsAllCaps: true, warningPrefixIsBold: false })}
      />,
    );
    expect(screen.getByText("Warning prefix ALL CAPS:").parentElement?.textContent).toContain("yes");
    expect(screen.getByText("Warning prefix bold:").parentElement?.textContent).toContain("no");
  });
});
