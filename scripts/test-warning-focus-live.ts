/**
 * test-warning-focus-live.ts — prove the WARNING FOCUS escalation (src/extraction/warningFocus.ts)
 * on hard government-warning cases against the LIVE provider configured in .env.local (never the
 * mock; costs real model calls — keep runs modest).
 *
 * Renders three adversarial labels with sharp:
 *   subtle - condensed ALL-CAPS warning whose prefix is only slightly heavier than the body (the
 *            real-Fireball shape that parks the bold check at "could not be verified")
 *   rot90  - the same label rotated 90 degrees (the orientation requirement)
 *   tiny   - a small warning block on a large, busy label (the capture/recovery case)
 *
 * Each case runs through runExtraction twice: WARNING_FOCUS=0 (fast path only) vs =1 (escalation),
 * reporting warning capture, confidence, the 16.22 flags, focus-call count, and wall-clock.
 *
 *   npx tsx scripts/test-warning-focus-live.ts
 */
import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp") as typeof import("sharp");

function loadEnvLocal(): void {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const value = m[2].split(" #")[0].trim();
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

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

/** A busy Fireball-shaped back label whose warning body is ALL CAPS and whose prefix is only
 *  SLIGHTLY heavier (weight 600 vs 400) at small size — the subtle case the full-image judge
 *  cannot reliably call. `fontSize` shrinks the warning further for the `tiny` case. */
function hardLabelSvg(warning: string, fontSize: number): string {
  const lines = wrap(warning.toUpperCase(), Math.round(1050 / fontSize));
  const lineHeight = fontSize + 4;
  const warningText = lines
    .map((line, i) => {
      const y = 700 + i * lineHeight;
      if (i === 0) {
        const rest = line.slice("GOVERNMENT WARNING:".length);
        return `<text x="60" y="${y}" font-family="Arial" font-size="${fontSize}" font-weight="400" fill="#1f1f1f"><tspan font-weight="600">GOVERNMENT WARNING:</tspan>${rest}</text>`;
      }
      return `<text x="60" y="${y}" font-family="Arial" font-size="${fontSize}" font-weight="400" fill="#1f1f1f">${line}</text>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="1000" viewBox="0 0 660 1000">
  <rect width="660" height="1000" fill="#f0a32e"/>
  <text x="330" y="60" text-anchor="middle" font-family="Georgia" font-size="34" font-weight="bold" fill="#c8102e">IGNITE THE NITE</text>
  <text x="330" y="120" text-anchor="middle" font-family="Arial" font-size="21" font-weight="bold" fill="#1f1f1f">WHAT YOU HAVE HERE IS SMOOTH WHISKY</text>
  <text x="330" y="150" text-anchor="middle" font-family="Arial" font-size="21" font-weight="bold" fill="#1f1f1f">WITH A FIERY KICK OF RED HOT CINNAMON.</text>
  <text x="40" y="560" font-family="Arial" font-size="19" font-weight="bold" fill="#c8102e" transform="rotate(-90 40 560)">WWW.FIREBALLWHISKY.COM</text>
  <text x="630" y="300" font-family="Arial" font-size="19" font-weight="bold" fill="#c8102e" transform="rotate(90 630 300)">INFO@FIREBALLWHISKY.COM</text>
  <ellipse cx="330" cy="400" rx="170" ry="150" fill="#ffffff"/>
  <text x="330" y="620" text-anchor="middle" font-family="Arial" font-size="22" font-weight="bold" fill="#1f1f1f">CINNAMON WHISKY — ALC. 33% BY VOL. (66 PROOF)</text>
  <text x="330" y="655" text-anchor="middle" font-family="Arial" font-size="21" font-weight="bold" fill="#c8102e">IMPORTED BY SAZERAC CO., INC., LOUISVILLE, KY</text>
  ${warningText}
  <text x="60" y="880" font-family="Arial" font-size="22" font-weight="bold" fill="#1f1f1f">750 ML</text>
  <text x="330" y="975" text-anchor="middle" font-family="Arial" font-size="26" font-weight="bold" fill="#c8102e" letter-spacing="6">PRODUCT OF CANADA</text>
</svg>`;
}

interface CaseRow {
  case: string;
  focus: "off" | "on";
  captured: boolean;
  matches: boolean;
  conf: number | null;
  allCaps: boolean | null;
  bold: boolean | null;
  focusCalls: number;
  ms: number;
}

async function main(): Promise<void> {
  loadEnvLocal();
  if ((process.env.VISION_PROVIDER ?? "mock") === "mock") {
    console.error("Set a real provider in .env.local (the mock cannot exercise the focus pass).");
    process.exit(1);
  }
  const { getActiveProviders } = await import("../src/extraction");
  const { runExtraction } = await import("../src/pipeline");
  const { CANONICAL_GOVERNMENT_WARNING } = await import("../src/domain");

  const subtle = await sharp(Buffer.from(hardLabelSvg(CANONICAL_GOVERNMENT_WARNING, 12))).png().toBuffer();
  const rot90 = await sharp(subtle).rotate(90).png().toBuffer();
  const tiny = await sharp(Buffer.from(hardLabelSvg(CANONICAL_GOVERNMENT_WARNING, 8))).png().toBuffer();
  // The fast path's judge votes vary run to run, so single runs can resolve by luck — repeat each
  // arm so the escalation is actually exercised on the runs where the fast path lands null.
  const cases: { name: string; data: Buffer; reps: number }[] = [
    { name: "subtle", data: subtle, reps: 3 },
    { name: "rot90", data: rot90, reps: 3 },
    { name: "tiny", data: tiny, reps: 1 },
  ];

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const rows: CaseRow[] = [];
  for (const c of cases) {
    for (let rep = 0; rep < c.reps; rep++)
    for (const focus of ["off", "on"] as const) {
      process.env.WARNING_FOCUS = focus === "on" ? "1" : "0";
      const providers = getActiveProviders();
      let focusCalls = 0;
      for (const p of providers) {
        const orig = p.focusWarning?.bind(p);
        if (orig) {
          p.focusWarning = async (images, signal) => {
            focusCalls++;
            console.log(`  [focus stage ${focusCalls}] ${images.map((i) => i.filename).join(", ")}`);
            return orig(images, signal);
          };
        }
      }
      const started = Date.now();
      try {
        const out = await runExtraction(
          providers,
          [{ filename: `${c.name}.png`, data: new Uint8Array(c.data), contentType: "image/png", position: "back" }],
          8000,
        );
        const text = (out.extracted.warningText ?? "").trim();
        rows.push({
          case: c.name,
          focus,
          captured: text !== "",
          matches: text !== "" && norm(text) === norm(CANONICAL_GOVERNMENT_WARNING),
          conf: out.extracted.confidence.warningText ?? null,
          allCaps: out.extracted.warningPrefixIsAllCaps,
          bold: out.extracted.warningPrefixIsBold,
          focusCalls,
          ms: Date.now() - started,
        });
      } catch (e) {
        rows.push({
          case: c.name,
          focus,
          captured: false,
          matches: false,
          conf: null,
          allCaps: null,
          bold: null,
          focusCalls,
          ms: Date.now() - started,
        });
        console.error(`${c.name}/${focus}: ${(e as Error).message}`);
      }
    }
  }

  console.log("\ncase    focus  captured  matches  conf   allCaps  bold   focusCalls  ms");
  for (const r of rows) {
    console.log(
      `${r.case.padEnd(7)} ${r.focus.padEnd(6)} ${String(r.captured).padEnd(9)} ${String(r.matches).padEnd(8)} ` +
        `${String(r.conf ?? "-").padEnd(6)} ${String(r.allCaps).padEnd(8)} ${String(r.bold).padEnd(6)} ` +
        `${String(r.focusCalls).padEnd(11)} ${r.ms}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
