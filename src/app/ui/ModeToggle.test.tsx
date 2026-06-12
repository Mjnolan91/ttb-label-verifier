// @vitest-environment jsdom
/**
 * ModeToggle.test.tsx — the header mode switch: a link that always points at the OTHER screen
 * (single verify <-> batch worklist), labeled by destination, and aware of /batch subpaths.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: usePathnameMock }));

import { ModeToggle } from "./ModeToggle";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ModeToggle", () => {
  it("on the single verify screen, offers batch mode", () => {
    usePathnameMock.mockReturnValue("/");
    render(<ModeToggle />);
    const link = screen.getByRole("link", { name: /switch to batch mode/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/batch");
    expect(link.textContent).toContain("Batch");
  });

  it("on the batch screen, offers the single label screen", () => {
    usePathnameMock.mockReturnValue("/batch");
    render(<ModeToggle />);
    const link = screen.getByRole("link", { name: /switch to single-label mode/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/");
    expect(link.textContent).toContain("Single");
  });

  it("treats a /batch subpath as batch mode", () => {
    usePathnameMock.mockReturnValue("/batch/anything");
    render(<ModeToggle />);
    expect(
      (screen.getByRole("link", { name: /switch to single-label mode/i }) as HTMLAnchorElement).getAttribute("href"),
    ).toBe("/");
  });

  it("offers batch from any other route, including a null pathname", () => {
    usePathnameMock.mockReturnValue("/somewhere");
    const { unmount } = render(<ModeToggle />);
    expect(
      (screen.getByRole("link", { name: /switch to batch mode/i }) as HTMLAnchorElement).getAttribute("href"),
    ).toBe("/batch");
    unmount();

    usePathnameMock.mockReturnValue(null as unknown as string);
    render(<ModeToggle />);
    expect(
      (screen.getByRole("link", { name: /switch to batch mode/i }) as HTMLAnchorElement).getAttribute("href"),
    ).toBe("/batch");
  });

  it("renders no em dashes (project copy standard)", () => {
    usePathnameMock.mockReturnValue("/");
    const { container } = render(<ModeToggle />);
    expect(container.textContent).not.toContain("—");
  });
});
