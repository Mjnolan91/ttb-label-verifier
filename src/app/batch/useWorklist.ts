"use client";

/**
 * useWorklist — the review worklist store for the batch screen (Feature B). Each product the agent
 * reviews keeps its own record: the resolved per-field flags (so the verdict resumes exactly), the
 * recorded decision (Approve / Reject-send-back), and an optional note. Records are keyed by product
 * name and persisted to localStorage, so a refresh or a later session RESUMES the worklist.
 *
 * Privacy: public label data only — keys, decisions, and notes stay in this browser and are never
 * transmitted (mirrors the offline-by-default, no-PII posture of the rest of the app).
 */
import { useState } from "react";
import type { FieldNotes, FieldOverrides, ReviewDecision } from "../ui/labelReview";

export type { ReviewDecision };

export interface ReviewRecord {
  /** Resolved per-field flags — drives the resumed effective verdict. */
  overrides: FieldOverrides;
  /** The reviewer's free-text note per field (why flagged / what confirmed). */
  notes?: FieldNotes;
  /** The reviewer's recorded decision, once they commit one. */
  decision?: ReviewDecision;
  /** An optional free-text note captured with the decision. */
  note?: string;
  /** When the decision was recorded (ISO), for the audit trail / export. */
  decidedAt?: string;
}

/** The whole worklist, keyed by product name. */
export type Worklist = Record<string, ReviewRecord>;

const STORAGE_KEY = "ttb-worklist-v1";

export function loadWorklist(): Worklist {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Worklist) : {};
  } catch {
    return {};
  }
}

export function saveWorklist(w: Worklist): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  } catch {
    /* private mode / quota — the worklist degrades to in-memory, which is acceptable for the demo. */
  }
}

export interface WorklistApi {
  worklist: Worklist;
  /** Persist a product's resolved flags (called as the reviewer confirms/flags fields). */
  setOverrides: (product: string, overrides: FieldOverrides) => void;
  /** Persist a product's per-field reviewer notes. */
  setNotes: (product: string, notes: FieldNotes) => void;
  /** Record (or re-record) a product's decision + note. */
  recordDecision: (product: string, decision: ReviewDecision, note: string) => void;
  /** Forget one product's record (back to un-reviewed). */
  reset: (product: string) => void;
  /** Empty the whole worklist. */
  clearAll: () => void;
}

export function useWorklist(): WorklistApi {
  // Lazy-init from storage. Safe for SSR/hydration here: the batch screen's initial render shows no
  // rows (nothing depends on the worklist until a batch is processed), so server ({}) and client
  // (stored) first renders produce identical DOM.
  const [worklist, setWorklist] = useState<Worklist>(() => loadWorklist());

  // Mutators persist EXPLICITLY (no change-effect), so persistence stays a deliberate, testable action.
  const update = (fn: (prev: Worklist) => Worklist) =>
    setWorklist((prev) => {
      const next = fn(prev);
      saveWorklist(next);
      return next;
    });

  return {
    worklist,
    setOverrides: (product, overrides) =>
      update((prev) => ({ ...prev, [product]: { ...prev[product], overrides } })),
    setNotes: (product, notes) =>
      update((prev) => ({ ...prev, [product]: { ...prev[product], overrides: prev[product]?.overrides ?? {}, notes } })),
    recordDecision: (product, decision, note) =>
      update((prev) => ({
        ...prev,
        [product]: {
          overrides: prev[product]?.overrides ?? {},
          decision,
          note,
          decidedAt: new Date().toISOString(),
        },
      })),
    reset: (product) =>
      update((prev) => {
        const next = { ...prev };
        delete next[product];
        return next;
      }),
    clearAll: () => update(() => ({})),
  };
}
