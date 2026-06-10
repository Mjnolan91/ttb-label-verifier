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

  it("setApplication MERGES per key — several writes in one event accumulate (Accept all)", () => {
    const { result } = renderHook(() => useWorklist());
    // Fired back-to-back in ONE act, the way an "Accept all" click writes several fields: each call
    // must merge against the latest state, not last-write-wins over a stale snapshot.
    act(() => {
      result.current.setApplication("acme", { brand: "Acme" });
      result.current.setApplication("acme", { alcoholContent: "40% Alc./Vol." });
    });
    expect(loadWorklist().acme.application).toEqual({ brand: "Acme", alcoholContent: "40% Alc./Vol." });
    // An explicit empty string persists (it CLEARS a CSV value, distinct from "no edit").
    act(() => result.current.setApplication("acme", { brand: "" }));
    expect(loadWorklist().acme.application).toEqual({ brand: "", alcoholContent: "40% Alc./Vol." });
  });

  it("invalidateReview clears flags AND the recorded decision, keeping notes and application edits", () => {
    const { result } = renderHook(() => useWorklist());
    act(() => {
      result.current.setOverrides("acme", { brand: "ok", warning: "issue" });
      result.current.setNotes("acme", { warning: "prefix looks light" });
      result.current.setApplication("acme", { brand: "Acme" });
      result.current.recordDecision("acme", "approve", "looks good");
    });
    act(() => result.current.invalidateReview("acme"));
    const rec = loadWorklist().acme;
    expect(rec.overrides).toEqual({});
    // The decision was made against DIFFERENT inputs: a stale "Approved" surviving an application
    // edit whose recomputed verdict says reject is a false approval. The row returns to Undecided.
    expect(rec.decision).toBeUndefined();
    expect(rec.note).toBeUndefined();
    expect(rec.decidedAt).toBeUndefined();
    expect(rec.notes?.warning).toBe("prefix looks light"); // commentary survives
    expect(rec.application?.brand).toBe("Acme"); // the edit that triggered the invalidation survives
    // Invalidating a product with no record is a no-op, never a phantom record.
    act(() => result.current.invalidateReview("ghost"));
    expect(loadWorklist().ghost).toBeUndefined();
  });
});
