/**
 * route.test.ts — end-to-end /api/verify using the default MockVisionProvider.
 *
 * Posts multipart/form-data with a known fixture FILENAME (the mock keys off the name, so the image
 * bytes are a throwaway stub) and asserts the full JSON. Covers the extraction-first path (no claimed
 * values → fields only) and the optional verification (claimed supplied → verdict). No network.
 */
import { describe, it, expect } from "vitest";
import { POST, readBodyWithinCap } from "./route";

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
  it("400 when the image is missing (the only required input)", async () => {
    const res = await postForm(cleanClaim); // no image
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/image/i);
  });
});

describe("POST /api/verify — extraction-first (no claimed values → read only, no verdict)", () => {
  it("returns the extracted fields with result=null when no claimed values are supplied", async () => {
    const res = await postForm({}, stubImage("old-tom-bourbon-clean.svg"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.readable).toBe(true);
    expect(json.extracted.brand).toBe("OLD TOM DISTILLERY");
    expect(json.extracted.alcoholContentText).toBe("45% Alc./Vol. (90 Proof)");
    expect(json.result).toBeNull(); // no verification ran
    expect(json.claimed).toBeUndefined();
  });

  it("still verifies (and echoes claimed) when claimed values ARE supplied", async () => {
    const res = await postForm(cleanClaim, stubImage("old-tom-bourbon-clean.svg"));
    const json = await res.json();
    expect(json.result.overall).toBe("approve");
    expect(json.claimed.brand).toBe("OLD TOM DISTILLERY");
  });
});

describe("POST /api/verify — completeness + multi-image", () => {
  it("returns a TTB completeness result for a readable extraction", async () => {
    const res = await postForm({}, stubImage("old-tom-bourbon-clean.svg"));
    const json = await res.json();
    expect(json.readable).toBe(true);
    expect(json.completeness).toBeDefined();
    expect(json.completeness.beverageClass).toBe("distilledSpirits");
    expect(Array.isArray(json.completeness.elements)).toBe(true);
    expect(["complete", "incomplete", "review"]).toContain(json.completeness.overall);
  });

  it("accepts multiple images for one product and merges them", async () => {
    const form = new FormData();
    form.append("image", stubImage("old-tom-bourbon-clean.svg"));
    form.append("image", stubImage("old-tom-bourbon-clean.svg"));
    const res = await POST(new Request("http://localhost/api/verify", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.readable).toBe(true);
    expect(json.extracted.brand).toBe("OLD TOM DISTILLERY");
    expect(json.completeness).toBeDefined();
  });
});

describe("POST /api/verify — upload guards", () => {
  function postRaw(files: File[]): Promise<Response> {
    const form = new FormData();
    for (const f of files) form.append("image", f);
    return POST(new Request("http://localhost/api/verify", { method: "POST", body: form }));
  }

  it("rejects a non-image upload with 415", async () => {
    const res = await postRaw([new File([new Uint8Array([1, 2, 3, 4])], "doc.pdf", { type: "application/pdf" })]);
    expect(res.status).toBe(415);
  });

  it("rejects more than the per-product image cap with 413", async () => {
    const res = await postRaw(Array.from({ length: 5 }, (_, i) => stubImage(`x${i}.svg`)));
    expect(res.status).toBe(413);
  });
});

describe("readBodyWithinCap — bound memory before parsing (no-content-length DoS guard)", () => {
  const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    });

  it("returns the buffered bytes when the body is within the cap", async () => {
    const out = await readBodyWithinCap(streamOf(new Uint8Array([1, 2, 3])), 10);
    expect(out).toBeInstanceOf(Uint8Array);
    expect((out as Uint8Array).length).toBe(3);
  });

  it("aborts with 'too-large' once the running total exceeds the cap", async () => {
    const out = await readBodyWithinCap(streamOf(new Uint8Array([1, 2, 3, 4, 5])), 3);
    expect(out).toBe("too-large");
  });

  it("returns null when there is no readable body stream (caller falls back)", async () => {
    expect(await readBodyWithinCap(null, 10)).toBeNull();
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
