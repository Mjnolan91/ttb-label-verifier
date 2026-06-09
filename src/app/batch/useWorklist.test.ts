// @vitest-environment jsdom
/**
 * useWorklist.test.ts — the review worklist store (Feature B). Locks the lifecycle: a recorded decision
 * + resolved flags persist to localStorage, RESUME on a fresh mount, and Clear-all empties the store.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWorklist, loadWorklist, saveWorklist } from "./useWorklist";

afterEach(() => {
  window.localStorage.clear();
});

describe("useWorklist — persistence + resume", () => {
  it("records a decision + note and persists it to localStorage", () => {
    const { result } = renderHook(() => useWorklist());
    act(() => result.current.recordDecision("acme", "approve", "looks good"));
    expect(result.current.worklist.acme.decision).toBe("approve");
    const stored = loadWorklist();
    expect(stored.acme.decision).toBe("approve");
    expect(stored.acme.note).toBe("looks good");
    expect(stored.acme.decidedAt).toBeTruthy();
  });

  it("resumes a saved worklist (decision + resolved flags) on a fresh mount", () => {
    saveWorklist({ acme: { overrides: { brand: "ok" }, decision: "reject", note: "bad brand" } });
    const { result } = renderHook(() => useWorklist());
    expect(result.current.worklist.acme.decision).toBe("reject");
    expect(result.current.worklist.acme.overrides.brand).toBe("ok");
  });

  it("persists resolved flags via setOverrides, and clearAll empties the store", () => {
    const { result } = renderHook(() => useWorklist());
    act(() => result.current.setOverrides("acme", { warning: "issue" }));
    expect(loadWorklist().acme.overrides.warning).toBe("issue");
    act(() => result.current.clearAll());
    expect(result.current.worklist).toEqual({});
    expect(loadWorklist()).toEqual({});
  });

  it("persists per-field reviewer notes via setNotes", () => {
    const { result } = renderHook(() => useWorklist());
    act(() => result.current.setNotes("acme", { brand: "label print is faded" }));
    expect(loadWorklist().acme.notes?.brand).toBe("label print is faded");
  });

  it("keeps per-field notes when a decision is recorded AFTER them (no data loss on commit)", () => {
    const { result } = renderHook(() => useWorklist());
    act(() => result.current.setNotes("acme", { brand: "label print is faded" }));
    act(() => result.current.recordDecision("acme", "reject", "send back"));
    expect(result.current.worklist.acme.decision).toBe("reject");
    expect(result.current.worklist.acme.notes?.brand).toBe("label print is faded"); // survived the commit
    expect(loadWorklist().acme.notes?.brand).toBe("label print is faded"); // and persisted
  });

  it("loadWorklist tolerates absent / corrupt storage", () => {
    window.localStorage.setItem("ttb-worklist-v1", "{not json");
    expect(loadWorklist()).toEqual({});
  });
});
