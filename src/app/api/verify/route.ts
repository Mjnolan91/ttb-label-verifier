/**
 * POST /api/verify — run extraction then deterministic comparison for one label.
 *
 * Accepts multipart/form-data: an `image` file plus the claimed field values (`brand`,
 * `alcoholContent`, optional `classType`, `netContents`). Calls the configured VisionProvider
 * (mock by default — offline), then verifyLabel(), and returns the per-field results plus an
 * overall verdict as JSON. Uses the web-standard Request/Response so it is offline-testable.
 */
import type { ClaimedFields } from "@/domain";
import { getVisionProvider } from "@/extraction";
import { verifyLabel } from "@/compare";
import type { VerifyApiResponse } from "./contract";

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data with an image and the claimed field values." },
      { status: 400 },
    );
  }

  const image = form.get("image");
  const brand = field(form, "brand");
  const alcoholContent = field(form, "alcoholContent");
  const classType = field(form, "classType");
  const netContents = field(form, "netContents");

  // Validation -> clear 4xx.
  if (!(image instanceof File) || image.size === 0) {
    return Response.json({ error: "An image file is required." }, { status: 400 });
  }
  const missing: string[] = [];
  if (!brand) missing.push("brand");
  if (!alcoholContent) missing.push("alcoholContent");
  if (missing.length > 0) {
    return Response.json(
      { error: `Missing required field(s): ${missing.join(", ")}.` },
      { status: 400 },
    );
  }

  const claimed: ClaimedFields = {
    brand,
    classType: classType || undefined,
    alcoholContentText: alcoholContent,
    netContents: netContents || undefined,
  };

  const provider = getVisionProvider();
  const bytes = new Uint8Array(await image.arrayBuffer());

  let extracted;
  try {
    extracted = await provider.extract({
      filename: image.name,
      data: bytes,
      contentType: image.type || undefined,
    });
  } catch (err) {
    return Response.json(
      { error: "Extraction failed.", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const result = verifyLabel(claimed, extracted);
  const payload: VerifyApiResponse = { provider: provider.name, claimed, extracted, result };
  return Response.json(payload);
}
