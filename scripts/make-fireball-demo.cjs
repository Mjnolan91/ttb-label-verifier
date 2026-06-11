/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS build-time script (not app code) */
/*
 * make-fireball-demo.cjs — build the Fireball demo labels from the source artwork.
 *
 * The demo's sample product is a REAL label (Fireball Cinnamon Whisky, imported by Sazerac Co.,
 * Louisville KY; the label artwork is from the public TTB COLA registry): a front/back pair, so
 * the walkthrough exercises the joint multi-image read AND the import path (PRODUCT OF CANADA +
 * importer line). Three derived files:
 *
 *   fireball-front.jpg                 the front panel, upscaled 4x (lanczos) so the live
 *   fireball-back.jpg                  provider gets real stroke detail on the fine print
 *   fireball-warning-not-bold-back.jpg
 *
 * BOTH back variants re-render the statutory warning block at print fidelity: the source is a
 * 672px web image, far below real COLA artwork resolution, and at that size the prefix's bold
 * differential is too weak for ANY reader (human or model) to verify honestly (the same
 * measurement that drove make-fear-the-dragon-demo.cjs). The two variants are IDENTICAL except
 * the statutory variable: the clean back prints the "GOVERNMENT WARNING:" prefix ALL-CAPS BOLD
 * (27 CFR 16.22(a)(2) compliant); the defect variant prints it "Government Warning:" in TITLE
 * CASE and REGULAR weight. Title case is deliberate: the caps rule is judged from the TRANSCRIPT
 * (deterministic on a live model), while a pure weight-only defect measures as "could not be
 * verified as bold" and routes to review — honest, but a mushy demo. The real product's label is
 * compliant; the defect variant exists only so the demo can show a hard Reject.
 *
 * Sources are the original artwork JPGs, kept OUTSIDE the repo (real-brand images are not
 * committed; see SOURCE_DIR). Output goes to eval/fixtures/images/ — copy to public/samples/ in
 * lockstep (src/app/samples.test.ts enforces byte-equality).
 *
 * Run from the repo root:  node scripts/make-fireball-demo.cjs [sourceDir]
 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const SOURCE_DIR = process.argv[2] || "C:/Users/Matt/Downloads/COLA Labels";
const OUT_DIR = path.join(__dirname, "..", "eval", "fixtures", "images");
const SAMPLES_DIR = path.join(__dirname, "..", "public", "samples");

// The canonical wording, wrapped to the label's own line breaks (the source prints 4 lines).
const WARNING_LINES = [
  "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD",
  "NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF",
  "BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR",
  "ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS.",
];

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });

  // Front: upscale 276x423 -> 1104x1692.
  const front = await sharp(path.join(SOURCE_DIR, "FIREBALL_FRONT.jpg"))
    .resize({ width: 1104, kernel: "lanczos3" })
    .jpeg({ quality: 90 })
    .toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, "fireball-front.jpg"), front);

  // Back: upscale 672x1024 -> 1344x2048.
  const back = await sharp(path.join(SOURCE_DIR, "FIREBALL_BACK.jpg"))
    .resize({ width: 1344, kernel: "lanczos3" })
    .jpeg({ quality: 90 })
    .toBuffer();

  // Re-render the warning block on BOTH variants (see header): patch with the local orange tone,
  // then draw the same all-caps lines. The ONLY difference between the two outputs is the
  // prefix's case + font weight. Coordinates are in the 1344x2048 upscaled space: the block sits
  // between the importer line (~y1395) and the toll-free row (~y1660).
  const PATCH_TOP = 1432; // below the importer line, above the original warning block
  const PATCH_BOTTOM = 1648; // above the TOLL FREE row
  const stats = await sharp(back)
    .extract({ left: 120, top: 1404, width: 1100, height: 20 }) // the text-free orange gap band
    .stats();
  const [r, g, b] = stats.channels.map((c) => Math.round(c.mean));
  const fill = `rgb(${r},${g},${b})`;

  const PREFIX = "GOVERNMENT WARNING:";
  const overlayFor = (compliant) => `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1344" height="2048">
  <rect x="0" y="${PATCH_TOP}" width="1344" height="${PATCH_BOTTOM - PATCH_TOP}" fill="${fill}"/>
  ${WARNING_LINES.map((line, i) => {
    const body = line.startsWith(PREFIX)
      ? `<tspan font-weight="${compliant ? 700 : 400}">${esc(compliant ? PREFIX : "Government Warning:")}</tspan><tspan font-weight="400">${esc(line.slice(PREFIX.length))}</tspan>`
      : esc(line);
    return `<text x="672" y="${1488 + i * 38}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="400" fill="#231a08" xml:space="preserve">${body}</text>`;
  }).join("\n  ")}
</svg>`;

  for (const [file, compliant] of [
    ["fireball-back.jpg", true],
    ["fireball-warning-not-bold-back.jpg", false],
  ]) {
    const out = await sharp(back)
      .composite([{ input: Buffer.from(overlayFor(compliant)), top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();
    fs.writeFileSync(path.join(OUT_DIR, file), out);
  }

  // Byte-mirror all three into public/samples (the verify screen's sample-loader buttons).
  for (const f of ["fireball-front.jpg", "fireball-back.jpg", "fireball-warning-not-bold-back.jpg"]) {
    fs.copyFileSync(path.join(OUT_DIR, f), path.join(SAMPLES_DIR, f));
    console.log("wrote", f);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
