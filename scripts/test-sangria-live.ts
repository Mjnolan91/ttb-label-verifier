/**
 * test-sangria-live.ts — run the user's Sailor Sally's Sangria scenario against a LIVE /api/verify.
 *
 * Renders a faithful raster of the reported label (front + back panels: dual responsibility lines,
 * "PRODUCED & BOTTLED BY … VALENCIA, SPAIN." + "IMPORTED BY: SEA TRADER IMPORTS, MIAMI, FL.",
 * deliberately NO "Product of Spain" statement), POSTs it with the application values from the
 * user's screenshot, and reports what the live model read, what completeness flagged, the combined
 * verdict, and the wall-clock time.
 *
 *   npx tsx scripts/test-sangria-live.ts [baseUrl] [rounds]
 */
import path from "node:path";
import os from "node:os";
import { combinedVerdict, toClaimedFields } from "@/compare";
import type { ExtractedFields } from "@/domain";
import type { CompletenessResult } from "@/compare";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as typeof import("sharp");

const WARNING_BODY =
  "(1) According to the Surgeon General, women should not drink alcoholic beverages during " +
  "pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs " +
  "your ability to drive a car or operate machinery, and may cause health problems.";

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function labelSvg(): string {
  const warning = wrap("GOVERNMENT WARNING: " + WARNING_BODY, 52);
  const warningText = warning
    .map((line, i) => {
      const y = 300 + i * 24;
      if (i === 0) {
        const rest = line.slice("GOVERNMENT WARNING:".length);
        return `<text x="850" y="${y}" font-family="Arial" font-size="15" fill="#222"><tspan font-weight="bold">GOVERNMENT WARNING:</tspan>${rest}</text>`;
      }
      return `<text x="850" y="${y}" font-family="Arial" font-size="15" fill="#222">${line}</text>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1640" height="820" viewBox="0 0 1640 820">
  <rect width="1640" height="820" fill="#f6eedc"/>
  <rect x="20" y="20" width="780" height="780" fill="none" stroke="#7a3030" stroke-width="5"/>
  <rect x="820" y="20" width="800" height="780" fill="none" stroke="#7a3030" stroke-width="5"/>
  <!-- FRONT panel -->
  <text x="410" y="120" text-anchor="middle" font-family="Georgia" font-size="26" fill="#444">EST. 1928</text>
  <text x="410" y="240" text-anchor="middle" font-family="Georgia" font-size="64" font-weight="bold" fill="#9b2c2c">SAILOR SALLY'S</text>
  <text x="410" y="320" text-anchor="middle" font-family="Georgia" font-size="56" font-weight="bold" fill="#9b2c2c">SANGRIA</text>
  <text x="410" y="380" text-anchor="middle" font-family="Georgia" font-size="28" font-style="italic" fill="#a3742c">Sails to your senses</text>
  <text x="410" y="470" text-anchor="middle" font-family="Arial" font-size="32" font-weight="bold" fill="#2b4a5a">SUPERB SWEET SANGRIA BLEND</text>
  <text x="410" y="560" text-anchor="middle" font-family="Arial" font-size="26" fill="#a3742c">TRADITIONAL SPANISH RECIPE</text>
  <text x="410" y="640" text-anchor="middle" font-family="Arial" font-size="30" fill="#333">750 ML&#160;&#160;&#160;8.5% ALC/VOL (17 PROOF)</text>
  <!-- BACK panel -->
  <text x="1220" y="110" text-anchor="middle" font-family="Georgia" font-size="24" font-style="italic" fill="#333">Sailor Sally's stellar Sangria.</text>
  <text x="1220" y="145" text-anchor="middle" font-family="Georgia" font-size="24" font-style="italic" fill="#333">Splendidly sweet Spanish red wine,</text>
  <text x="1220" y="180" text-anchor="middle" font-family="Georgia" font-size="24" font-style="italic" fill="#333">sensational spices, sun-kissed citrus.</text>
  <text x="1220" y="215" text-anchor="middle" font-family="Georgia" font-size="24" font-style="italic" fill="#333">Shipmates love it!</text>
  <rect x="835" y="265" width="770" height="180" fill="none" stroke="#333" stroke-width="2.5"/>
  ${warningText}
  <text x="850" y="500" font-family="Arial" font-size="19" font-weight="bold" fill="#222">PRODUCED &amp; BOTTLED BY:</text>
  <text x="850" y="528" font-family="Arial" font-size="19" fill="#222">SAILOR SALLY'S CELLARS,</text>
  <text x="850" y="556" font-family="Arial" font-size="19" fill="#222">VALENCIA, SPAIN.</text>
  <text x="850" y="600" font-family="Arial" font-size="19" font-weight="bold" fill="#222">IMPORTED BY: <tspan font-weight="normal">SEA TRADER</tspan></text>
  <text x="850" y="628" font-family="Arial" font-size="19" fill="#222">IMPORTS, MIAMI, FL.</text>
  <text x="850" y="690" font-family="Arial" font-size="20" font-weight="bold" fill="#222">PLEASE DRINK RESPONSIBLY.</text>
</svg>`;
}

interface VerifyResponse {
  readable: boolean;
  message?: string;
  extracted: ExtractedFields;
  completeness?: CompletenessResult;
}

async function main(): Promise<void> {
  const base = (process.argv[2] ?? "http://localhost:3300").replace(/\/$/, "");
  const rounds = Math.max(1, Math.floor(Number(process.argv[3] ?? "1")));
  const png = await sharp(Buffer.from(labelSvg())).png().toBuffer();
  const out = path.join(os.tmpdir(), "sangria-live-test.png");
  await sharp(png).toFile(out);
  console.log(`Rendered test label -> ${out}`);
  console.log(`POSTing to ${base}/api/verify (${rounds} round(s))\n`);

  for (let i = 1; i <= rounds; i++) {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), "sangria-live-test.png");
    form.append("position", "front");
    form.append("brand", "Sailor Sally's");
    form.append("alcoholContent", "8.5% ALC/VOL (17 PROOF)");
    const t0 = performance.now();
    const res = await fetch(`${base}/api/verify`, { method: "POST", body: form });
    const seconds = ((performance.now() - t0) / 1000).toFixed(1);
    if (!res.ok) {
      console.log(`#${i}: HTTP ${res.status} after ${seconds}s`);
      continue;
    }
    const json = (await res.json()) as VerifyResponse;
    const e = json.extracted;
    const country = json.completeness?.elements.find((el) => el.key === "countryOfOrigin");
    // The headline the UI computes: comparison + completeness, same engine.
    const gate = toClaimedFields(
      { brand: "Sailor Sally's", alcoholContentText: "8.5% ALC/VOL (17 PROOF)", classType: "Sangria" },
      e,
    );
    const combined = json.readable ? combinedVerdict(gate.claimed, e) : null;
    console.log(`#${i}: ${seconds}s  readable=${json.readable}`);
    console.log(`    brand:             ${JSON.stringify(e.brand)} (conf ${e.confidence.brand ?? "-"})`);
    console.log(`    classType:         ${JSON.stringify(e.classType)}`);
    console.log(`    address:           ${JSON.stringify(e.address)}`);
    console.log(`    importerStatement: ${JSON.stringify(e.importerStatement)}`);
    console.log(`    countryOfOrigin:   ${JSON.stringify(e.countryOfOrigin)}`);
    console.log(`    completeness countryOfOrigin: ${country?.status ?? "-"} — ${country?.detail ?? "-"}`);
    console.log(`    COMBINED VERDICT: ${combined?.overall ?? "(unreadable)"}${combined?.gatedByCompleteness ? " (gated by completeness)" : ""}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
