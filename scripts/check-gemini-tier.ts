/**
 * check-gemini-tier.ts — verify which QUOTA TIER the configured Gemini API key actually gets.
 *
 * Why this exists: the key's tier follows the Google Cloud PROJECT it was created in, not the
 * account — a billing account on one project does nothing for a key minted in another (AI Studio's
 * default sandbox project is the classic trap). Paying for the Gemini consumer app does not raise
 * API quota either. The only ground truth is the API's behavior, so this bursts 30 tiny text-only
 * calls at the pro model (the one the warning judge uses) and reads the rate-limit response:
 * free tier caps pro at ~25 requests/min; a billed tier absorbs the burst without a 429.
 *
 *   npx tsx scripts/check-gemini-tier.ts
 *
 * Cost: ~30 minimal-token calls (a few cents at most on a paid tier; free-tier calls are free).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = "gemini-3.1-pro-preview"; // the warning judge's default — the model that needs the quota
const BURST = 30;

async function main(): Promise<void> {
  const env = await readFile(path.join(ROOT, ".env.local"), "utf8").catch(() => "");
  const key =
    /^GEMINI_API_KEY=([^#\r\n]+)/m.exec(env)?.[1]?.trim() ??
    process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    console.error("No GEMINI_API_KEY found in .env.local or the environment.");
    process.exitCode = 1;
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "Say OK" }] }],
    generationConfig: { maxOutputTokens: 5, thinkingConfig: { thinkingLevel: "low" } },
  });

  let ok = 0;
  let rateLimited = 0;
  let other = 0;
  let firstDetail = "";
  const t0 = performance.now();
  for (let i = 0; i < BURST; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body,
      });
      if (res.ok) ok++;
      else if (res.status === 429) {
        rateLimited++;
        if (!firstDetail) {
          const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          firstDetail = json?.error?.message?.split("\n")[0] ?? "";
        }
      } else other++;
    } catch {
      other++;
    }
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(0);

  console.log(`${BURST} calls to ${MODEL} in ${secs}s: ${ok} ok, ${rateLimited} rate-limited (429), ${other} other errors`);
  if (firstDetail) console.log(`First 429 detail: ${firstDetail}`);
  console.log("");
  if (rateLimited === 0 && ok >= BURST - 2) {
    console.log("PAID TIER CONFIRMED. Recommended next steps:");
    console.log("  1. Set SELF_CONSISTENCY_ESCALATION=2 in .env.local and in the Vercel env vars.");
    console.log("  2. Re-measure: npx tsx scripts/measure-live-latency.ts");
    console.log("  (Extraction stays on Flash by measurement; the Pro judge now holds under load.)");
  } else if (rateLimited > 0) {
    console.log("FREE-TIER QUOTA: this key's PROJECT does not have an active paid tier.");
    console.log("  1. In https://aistudio.google.com/apikey find this key and note its Google Cloud project.");
    console.log("  2. Your billing account must be linked to THAT project (console.cloud.google.com > Billing");
    console.log("     > Account management > linked projects). If it is linked to a different project, the");
    console.log("     simplest fix is: create a NEW key in AI Studio choosing the BILLED project, put it in");
    console.log("     .env.local (GEMINI_API_KEY=...) and in Vercel, then re-run this script.");
  } else {
    console.log("Inconclusive (network errors dominated). Re-run on a stable connection.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
