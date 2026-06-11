/**
 * focus/route.test.ts — the second look's API surface with the default offline provider.
 *
 * The mock has no `readFields`, so this route's offline behavior is the honest "unsupported"
 * answer (the batch row's note says a second look isn't available — never a pretended look). The
 * recovery semantics themselves are unit-tested with stub providers in
 * src/extraction/secondLook.test.ts; the validation paths here guard the unauthenticated endpoint.
 */
import { describe, expect, it } from "vitest";
import { POST } from "./route";

function stubImage(filename: string): File {
  return new File([new Uint8Array([1, 2, 3, 4])], filename, { type: "image/jpeg" });
}

function postForm(build: (form: FormData) => void): Promise<Response> {
  const form = new FormData();
  build(form);
  return POST(new Request("http://localhost/api/verify/focus", { method: "POST", body: form }));
}

describe("POST /api/verify/focus", () => {
  it("reports supported=false on the offline mock (no readFields) instead of pretending a look", async () => {
    const res = await postForm((form) => {
      form.set("image", stubImage("old-tom-bourbon-clean.svg"));
      form.set("fields", "netContents,warningText");
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.provider).toBe("mock");
    expect(json.supported).toBe(false);
    expect(json.fields).toEqual({});
  });

  it("rejects an unknown field key loudly (a caller bug, not a quiet different read)", async () => {
    const res = await postForm((form) => {
      form.set("image", stubImage("x.jpg"));
      form.set("fields", "netContents,evilKey");
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/evilKey/);
  });

  it("requires at least one field key and at least one image", async () => {
    const noFields = await postForm((form) => form.set("image", stubImage("x.jpg")));
    expect(noFields.status).toBe(400);
    const noImage = await postForm((form) => form.set("fields", "netContents"));
    expect(noImage.status).toBe(400);
  });

  it("rejects non-image uploads", async () => {
    const res = await postForm((form) => {
      form.set("image", new File([new Uint8Array([1])], "x.txt", { type: "text/plain" }));
      form.set("fields", "netContents");
    });
    expect(res.status).toBe(415);
  });
});
