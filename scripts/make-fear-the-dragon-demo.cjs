/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS build-time script (not app code) */
/*
 * make-fear-the-dragon-demo.cjs — build the Fear the Dragon demo labels from the source artwork.
 *
 * The demo's sample product is a REAL label (Dragon Distillery x Flying Dog, Frederick MD): a
 * front/back pair, so the walkthrough exercises the joint multi-image read. Three derived files:
 *
 *   fear-the-dragon-front.jpg              the front panel, upscaled 2x (lanczos) so the live
 *   fear-the-dragon-back.jpg               provider gets real stroke detail on the fine print
 *   fear-the-dragon-warning-not-bold-back.jpg
 *
 * BOTH back variants re-render the statutory warning block at print fidelity: the source is a
 * 450px web image, far below real COLA artwork resolution, and at that size the prefix's bold
 * differential is too weak for ANY reader (human or model) to verify honestly — measured live,
 * the bold judge returned "unverifiable" and the clean pair could never demo an Approve. The two
 * variants are IDENTICAL except the one statutory variable: the clean back prints the
 * "GOVERNMENT WARNING:" prefix in BOLD type (27 CFR 16.22(a)(2) compliant), the not-bold variant
 * prints it in REGULAR weight (still all caps) — the one defect that hard-fails on format alone.
 * The real product's label is compliant; the defect variant exists only so the demo can show a
 * Reject.
 *
 * Sources are the original artwork JPGs, kept OUTSIDE the repo (real-brand images are not
 * committed; see SOURCE_DIR). Output goes to eval/fixtures/images/ — copy to public/samples/ in
 * lockstep (src/app/samples.test.ts enforces byte-equality).
 *
 * Run from the repo root:  node scripts/make-fear-the-dragon-demo.cjs [sourceDir]
 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const SOURCE_DIR = process.argv[2] || "C:/Users/Matt/Downloads/COLA Labels";
const OUT_DIR = path.join(__dirname, "..", "eval", "fixtures", "images");
const SAMPLES_DIR = path.join(__dirname, "..", "public", "samples");

const WARNING_LINES = [
  "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD NOT",
  "DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF BIRTH DEFECTS.",
  "(2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR ABILITY TO DRIVE A CAR",
  "OR OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS.",
];

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });

  // Front: upscale 600x600 -> 1200x1200.
  const front = await sharp(path.join(SOURCE_DIR, "FEAR_THE_DRAGON_FRONT.jpg"))
    .resize({ width: 1200, kernel: "lanczos3" })
    .jpeg({ quality: 90 })
    .toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, "fear-the-dragon-front.jpg"), front);

  // Back: upscale 450x563 -> 900x1126.
  const backSharp = sharp(path.join(SOURCE_DIR, "FEAR_THE_DRAGON_BACK.jpg")).resize({
    width: 900,
    kernel: "lanczos3",
  });
  const back = await backSharp.jpeg({ quality: 90 }).toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, "fear-the-dragon-back.jpg"), back);

  // Re-render the warning block on BOTH variants (see header): patch with the local parchment
  // tone, then draw the same all-caps lines. The ONLY difference between the two outputs is the
  // prefix's font weight. Coordinates are in the 900x1126 upscaled space.
  const PATCH_TOP = 972; // below the 750ML statement (~y963), above the warning block (~y988)
  const stats = await sharp(back)
    .extract({ left: 24, top: 966, width: 852, height: 16 }) // the text-free parchment gap band
    .stats();
  const [r, g, b] = stats.channels.map((c) => Math.round(c.mean));
  const fill = `rgb(${r},${g},${b})`;

  const PREFIX = "GOVERNMENT WARNING:";
  const overlayFor = (boldPrefix) => `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1126">
  <rect x="0" y="${PATCH_TOP}" width="900" height="${1126 - PATCH_TOP}" fill="${fill}"/>
  ${WARNING_LINES.map((line, i) => {
    const body = line.startsWith(PREFIX)
      ? `<tspan font-weight="${boldPrefix ? 700 : 400}">${esc(PREFIX)}</tspan><tspan font-weight="400">${esc(line.slice(PREFIX.length))}</tspan>`
      : esc(line);
    return `<text x="450" y="${1004 + i * 27}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="400" fill="#2e2a24" xml:space="preserve">${body}</text>`;
  }).join("\n  ")}
</svg>`;

  for (const [file, boldPrefix] of [
    ["fear-the-dragon-back.jpg", true],
    ["fear-the-dragon-warning-not-bold-back.jpg", false],
  ]) {
    const out = await sharp(back)
      .composite([{ input: Buffer.from(overlayFor(boldPrefix)), top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();
    fs.writeFileSync(path.join(OUT_DIR, file), out);
  }

  // Byte-mirror all three into public/samples (the verify screen's download links).
  for (const f of [
    "fear-the-dragon-front.jpg",
    "fear-the-dragon-back.jpg",
    "fear-the-dragon-warning-not-bold-back.jpg",
  ]) {
    fs.copyFileSync(path.join(OUT_DIR, f), path.join(SAMPLES_DIR, f));
    console.log("wrote", f);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
