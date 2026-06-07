/**
 * route.test.ts (US-005) — end-to-end /api/verify using the default MockVisionProvider.
 *
 * Posts multipart/form-data with a known fixture FILENAME (the mock keys off the name, so the
 * image bytes are a throwaway stub) and asserts the full JSON. No network; fully offline.
 */
import { describe, it, expect } from "vitest";
import { POST } from "./route";

function stubImage(filename: string): File {
  return new File([new Uint8Array([1, 2, 3, 4])], filename, { type: "image/svg+xml" });
}

function postForm(fields: Record<string, string>, image?: File): Promise<Response> {
  const form = new FormData();
  if (image) form.set("image", image);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return POST(new Request("http://localhost/api/verify", { method: "POST", body: form }));
}

const cleanClaim = {
  brand: "OLD TOM DISTILLERY",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  classType: "distilled-spirits",
  netContents: "750 mL",
};

describe("POST /api/verify — happy path (known clean fixture)", () => {
  it("returns 200 with per-field results and overall=approve", async () => {
    const res = await postForm(cleanClaim, stubImage("old-tom-bourbon-clean.svg"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.provider).toBe("mock");
    expect(json.readable).toBe(true);
    expect(json.result.overall).toBe("approve");
    expect(json.result.brand.status).toBe("pass");
    expect(json.result.alcohol.status).toBe("pass");
    expect(json.result.warning.status).toBe("pass");
    // echoes the extracted fields for the UI to show side-by-side
    expect(json.extracted.brand).toBe("OLD TOM DISTILLERY");
  });
});

describe("POST /api/verify — a deliberately broken fixture", () => {
  it("rejects an out-of-tolerance ABV end to end", async () => {
    const res = await postForm(cleanClaim, stubImage("abv-out-of-tolerance.svg"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.alcohol.status).toBe("fail");
    expect(json.result.overall).toBe("reject");
  });
});

describe("POST /api/verify — unreadable / low-confidence (re-upload, no verdict)", () => {
  it("returns readable=false with a re-upload message for the unreadable fixture", async () => {
    const res = await postForm(cleanClaim, stubImage("unreadable-blurry.svg"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.readable).toBe(false);
    expect(json.result).toBeNull(); // never a fabricated verdict
    expect(json.message).toMatch(/re-upload|clearer/i);
  });

  it("returns readable=false for an unrecognized filename with an honest demo-mode message", async () => {
    const res = await postForm(cleanClaim, stubImage("some-random-unknown-image.png"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.readable).toBe(false);
    expect(json.result).toBeNull();
    // Explains WHY (demo mode), rather than misleadingly claiming the photo was blurry.
    expect(json.message).toMatch(/demo|sample labels/i);
  });
});

describe("POST /api/verify — validation (clear 4xx)", () => {
  it("400 when the image is missing", async () => {
    const res = await postForm(cleanClaim); // no image
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/image/i);
  });

  it("400 when required claimed fields are missing", async () => {
    const res = await postForm({ classType: "distilled-spirits" }, stubImage("old-tom-bourbon-clean.svg"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/brand/);
    expect(json.error).toMatch(/alcoholContent/);
  });
});

describe("POST /api/verify — misconfigured real provider (fail loud, no silent mock fallback)", () => {
  async function withEnv(
    vars: Record<string, string | undefined>,
    fn: () => Promise<void>,
  ): Promise<void> {
    const keys = Object.keys(vars);
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) {
      if (vars[k] === undefined) delete process.env[k];
      else process.env[k] = vars[k];
    }
    try {
      await fn();
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  }

  it("returns an actionable 500 when VISION_PROVIDER=llm but Azure is unconfigured", async () => {
    await withEnv(
      {
        VISION_PROVIDER: "llm",
        AZURE_OPENAI_ENDPOINT: undefined,
        AZURE_OPENAI_API_KEY: undefined,
        AZURE_OPENAI_DEPLOYMENT: undefined,
      },
      async () => {
        // A KNOWN mock fixture filename — proves the route does NOT silently fall back to the mock.
        const res = await postForm(cleanClaim, stubImage("old-tom-bourbon-clean.svg"));
        expect(res.status).toBe(500);
        const json = await res.json();
        expect(json.error).toMatch(/not configured/i);
        expect(json.detail).toMatch(/AZURE_OPENAI/);
        expect(json.result).toBeUndefined(); // no verdict
        expect(json.message).toBeUndefined(); // not the demo-mock message either
      },
    );
  });
});
