/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS build-time script (not app code) */
/*
 * generate-demo-labels.cjs — (re)generate the REAL raster demo labels used as eval fixtures.
 *
 * These are REAL, readable raster labels (unlike the hermetic .svg fixture stubs) so a real
 * provider (VISION_PROVIDER=openai/llm) can extract genuine pixels from them. Authored as SVG
 * here for exact control over the text and the deliberate defects, then rasterized to PNG with
 * sharp (a transitive Next dependency — no new package). Output filenames are kept in lockstep
 * with eval/fixtures/cases.json; the offline mock keys off these filenames.
 *
 * Run from the repo root:  node scripts/generate-demo-labels.cjs
 * Writes to eval/fixtures/images/.
 */
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const WARNING_BODY =
  "(1) According to the Surgeon General, women should not drink alcoholic beverages during " +
  "pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs " +
  "your ability to drive a car or operate machinery, and may cause health problems.";

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrap(text, max) {
  const words = text.split(/\s+/);
  const lines = [];
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

const W = 720;
const H = 820;
const cx = W / 2;

function warningSvg(prefix) {
  const lines = wrap(prefix + " " + WARNING_BODY, 64);
  const startY = 540;
  const lh = 26;
  const x = 70;
  return lines
    .map((line, i) => {
      const y = startY + i * lh;
      if (i === 0) {
        const rest = esc(line.slice(prefix.length));
        return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="15" fill="#2b2017"><tspan font-weight="bold">${esc(prefix)}</tspan>${rest}</text>`;
      }
      return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="15" fill="#2b2017">${esc(line)}</text>`;
    })
    .join("\n  ");
}

function labelSvg(o) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#f7efda"/>
  <rect x="22" y="22" width="${W - 44}" height="${H - 44}" fill="none" stroke="#6b4e2e" stroke-width="4"/>
  <rect x="34" y="34" width="${W - 68}" height="${H - 68}" fill="none" stroke="#b08d57" stroke-width="1.5"/>

  <text x="${cx}" y="120" font-family="Arial, sans-serif" font-size="17" letter-spacing="6" text-anchor="middle" fill="#6b4e2e">${esc(o.tagTop)}</text>

  <text x="${cx}" y="195" font-family="Georgia, 'Times New Roman', serif" font-size="58" font-weight="bold" text-anchor="middle" fill="#3a2410">${esc(o.brand1)}</text>
  <text x="${cx}" y="250" font-family="Georgia, 'Times New Roman', serif" font-size="34" letter-spacing="8" text-anchor="middle" fill="#3a2410">${esc(o.brand2)}</text>

  <line x1="160" y1="285" x2="${W - 160}" y2="285" stroke="#b08d57" stroke-width="1.5"/>
  <text x="${cx}" y="325" font-family="Georgia, serif" font-size="23" font-style="italic" text-anchor="middle" fill="#4a361e">${esc(o.classType)}</text>

  <text x="${cx}" y="395" font-family="Arial, sans-serif" font-size="26" font-weight="bold" text-anchor="middle" fill="#2b2017">${esc(o.abv)}</text>
  <text x="${cx}" y="430" font-family="Arial, sans-serif" font-size="19" text-anchor="middle" fill="#4a361e">${esc(o.netContents)}</text>

  <text x="${cx}" y="485" font-family="Arial, sans-serif" font-size="14" letter-spacing="4" text-anchor="middle" fill="#6b4e2e">SMALL BATCH · KENTUCKY · EST. 1887</text>
  <line x1="70" y1="510" x2="${W - 70}" y2="510" stroke="#d8c39a" stroke-width="1"/>

  ${warningSvg(o.warningPrefix)}
</svg>`;
}

const BASE = {
  tagTop: "KENTUCKY STRAIGHT BOURBON",
  classType: "Kentucky Straight Bourbon Whiskey",
  abv: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
};

// Each entry's text is authored to match its cases.json `extracted` block (and thus the verdict).
const LABELS = {
  // Clean & compliant -> approve.
  "demo-old-tom-clean.png": { ...BASE, brand1: "OLD TOM", brand2: "DISTILLERY", warningPrefix: "GOVERNMENT WARNING:" },
  // Only defect: title-case warning prefix -> reject (27 CFR 16.22(a)(2)).
  "demo-warning-title-case.png": { ...BASE, brand1: "OLD TOM", brand2: "DISTILLERY", warningPrefix: "Government Warning:" },
  // Only defect: brand typo "Old Tomm" vs claimed "Old Tom" -> review.
  "demo-brand-typo.png": { ...BASE, brand1: "Old Tomm", brand2: "Distillery", warningPrefix: "GOVERNMENT WARNING:" },
};

// These rasters are filename-keyed EVAL FIXTURES only. (They were also the in-app sample
// downloads until 2026-06-11; the demo now ships the Fireball pair — see
// scripts/make-fireball-demo.cjs — so nothing is written to public/samples here.)
const outDirs = [path.join(__dirname, "..", "eval", "fixtures", "images")];

(async () => {
  for (const dir of outDirs) fs.mkdirSync(dir, { recursive: true });
  for (const [name, cfg] of Object.entries(LABELS)) {
    const png = await sharp(Buffer.from(labelSvg(cfg))).png().toBuffer();
    for (const dir of outDirs) {
      const out = path.join(dir, name);
      fs.writeFileSync(out, png);
      console.log("wrote", out);
    }
  }
})().catch((e) => {
  console.error("ERR", e && e.message ? e.message : e);
  process.exit(1);
});
