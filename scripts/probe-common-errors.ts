/**
 * probe-common-errors.ts — evidence harness: run the REAL comparators against a battery of common
 * human errors (application typos, unit variants, misspellings, junk) and print what each one
 * actually does. Not a test; a measurement of the "not getting it wrong" surface — re-run it when
 * a comparator's input tolerance changes. The regressions it has caught are pinned in
 * comparators.test.ts ("common human errors" describe block). `npx tsx scripts/probe-common-errors.ts`
 */
import { compareAlcohol, compareNetContents, compareBrand, compareOrigin, compareClassType } from "../src/compare/comparators";
import { parseAlcoholText } from "../src/compare/alcohol";

const LABEL_ALC = "40% ALC/VOL (80 PROOF)";
const row = (kind: string, input: string, status: string, reason: string) =>
  console.log(`${kind.padEnd(10)} | ${input.padEnd(34)} | ${status.padEnd(6)} | ${reason.slice(0, 90)}`);

console.log("\n=== APPLICATION-SIDE ALCOHOL TYPING (label prints '40% ALC/VOL (80 PROOF)') ===");
for (const claimed of ["40", "40%", "40 percent", "80 proof", "40% ABV", "40 % vol", "4O%", "40,5%", "40.0% Alc/Vol", "40 % alcohol by volume", ""]) {
  try {
    const r = compareAlcohol({ claimedText: claimed, extractedText: LABEL_ALC });
    row("alcohol", JSON.stringify(claimed), r.status, r.reason);
  } catch (e) {
    row("alcohol", JSON.stringify(claimed), "THROW", String(e));
  }
}
console.log("\n--- parseAlcoholText on the same inputs (what the parser sees) ---");
for (const t of ["40", "40 percent", "80 proof", "4O%", "40,5%"]) {
  console.log(`  ${JSON.stringify(t).padEnd(16)} ->`, JSON.stringify(parseAlcoholText(t)));
}

console.log("\n=== APPLICATION-SIDE NET CONTENTS (label prints '750 mL') ===");
for (const claimed of ["750ml", "750 ML", "75 cl", "0.75 L", ".75L", "750", "1 liter", "750 mL.", "750  mL"]) {
  try {
    const r = compareNetContents({ claimed, extracted: "750 mL" });
    row("net", JSON.stringify(claimed), r.status, r.reason);
  } catch (e) {
    row("net", JSON.stringify(claimed), "THROW", String(e));
  }
}

console.log("\n=== BRAND TYPING (label prints \"Jolly Jerry's\") ===");
for (const claimed of ["Jolly Jerrys", "JOLLY JERRY'S", "Jolly  Jerry's", "Jolly Jerry's.", "Jolly Jerry`s", "Joly Jerry's"]) {
  const r = compareBrand({ claimed, extracted: "Jolly Jerry's" });
  row("brand", JSON.stringify(claimed), r.status, r.reason);
}

console.log("\n=== ORIGIN TYPING (label prints 'Product of Barbados', address Bridgetown, Barbados.) ===");
for (const claimed of ["Barbados", "Product of Barbados", "Barbadoes", "barbados ", "Imported from Barbados", "Republic of Korea"]) {
  const r = compareOrigin({ claimed, extracted: "Product of Barbados", extractedAddress: "Bridgetown, Barbados." });
  row("origin", JSON.stringify(claimed), r.status, r.reason);
}
console.log("\n--- origin: BOTH sides carry the same misspelled/odd country ---");
for (const both of ["Product of Barbadoes", "Product of Hollend", "Made in U.S.A.", "Product of Republic of Korea", "Product of España"]) {
  const r = compareOrigin({ claimed: both, extracted: both, extractedAddress: "Bridgetown, Barbados." });
  row("origin=", JSON.stringify(both), r.status, r.reason);
}

console.log("\n=== CLASS/TYPE TYPING (label prints 'Kentucky Straight Bourbon Whiskey') ===");
for (const claimed of ["Burbon", "Whisky", "whiskey", "Distilled Spirits", "Sprits", "Wine"]) {
  const r = compareClassType({ claimed, extracted: "Kentucky Straight Bourbon Whiskey" });
  row("class", JSON.stringify(claimed), r.status, r.reason);
}

console.log("\n=== CRASH BATTERY (weird inputs through every comparator) ===");
const weird = ["", "   ", "🥃🥃🥃", "a".repeat(5000), "null", "'); DROP TABLE--"];
let crashes = 0;
for (const w of weird) {
  for (const [name, fn] of [
    ["alcohol", () => compareAlcohol({ claimedText: w, extractedText: w })],
    ["net", () => compareNetContents({ claimed: w, extracted: w })],
    ["brand", () => compareBrand({ claimed: w, extracted: w })],
    ["origin", () => compareOrigin({ claimed: w, extracted: w, extractedAddress: w })],
    ["class", () => compareClassType({ claimed: w, extracted: w })],
  ] as const) {
    try {
      (fn as () => unknown)();
    } catch (e) {
      crashes++;
      console.log(`  THROW in ${name} on ${JSON.stringify(w.slice(0, 30))}: ${String(e).slice(0, 80)}`);
    }
  }
}
console.log(crashes === 0 ? "  no crashes across the battery" : `  ${crashes} CRASHES`);
