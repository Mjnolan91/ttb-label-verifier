/**
 * route.partialRead.test.ts — the route FORWARDS per-image read failures (imageFailures) so a
 * silently-dropped image can never masquerade as a clean read, and pins the maxDuration export
 * (without it, Vercel kills a slow two-image read at the plan-default function timeout).
 * The pipeline is mocked here: the offline MockVisionProvider can't fail one image of a pair.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pipeline")>();
  return {
    ...actual,
    runExtraction: vi.fn(async () => ({
      readable: true,
      extracted: {
        brand: "Bonnaire",
        warningPrefixIsAllCaps: false,
        warningPrefixIsBold: null,
        confidence: { brand: 0.95 },
      },
      failedImages: [{ filename: "bonnaire-back.png", position: "back", reason: "timeout" }],
    })),
  };
});

import { POST, maxDuration } from "./route";

describe("POST /api/verify — partial image failure is forwarded", () => {
  it("carries imageFailures in the response so the UI can warn instead of staying silent", async () => {
    const form = new FormData();
    form.append("image", new File([new Uint8Array([1])], "bonnaire-front.png", { type: "image/png" }));
    form.append("position", "front");
    form.append("image", new File([new Uint8Array([1])], "bonnaire-back.png", { type: "image/png" }));
    form.append("position", "back");
    const res = await POST(new Request("http://localhost/api/verify", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.readable).toBe(true);
    expect(json.imageFailures).toEqual([
      { filename: "bonnaire-back.png", position: "back", reason: "timeout" },
    ]);
  });
});

describe("/api/verify — serverless duration", () => {
  it("exports maxDuration=60 so the env-tunable budgets (extract cap + 30s max rescue) fit inside it", () => {
    expect(maxDuration).toBe(60);
  });
});
