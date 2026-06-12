/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS build-time script (not app code) */
/*
 * make-submission-doc.cjs — generates docs/TTB-Label-Verifier-Approach-and-Design.docx, the
 * reviewer-facing approach document: three pages, first person, four sections (summary, what the
 * customers asked for, how it was implemented, why this architecture).
 *
 * Needs the `docx` package, which is deliberately NOT a project dependency (it is a doc build
 * tool, not app code). Copy this script into any scratch directory that has it:
 *
 *   npm i docx@9 && node make-submission-doc.cjs <repo>/docs/TTB-Label-Verifier-Approach-and-Design.docx
 *
 * Then export the GitHub-viewable PDF next to it (Word, LibreOffice, or any docx-to-pdf), and
 * update TEST_COUNT / FILE_COUNT / EVAL_CASES below to the suite's current numbers first. Keep it
 * at three pages: check the page count after any edit (Word's word count, or the PDF).
 */
const [, , OUT_PATH] = process.argv;
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun,
  Header, Footer, AlignmentType, ExternalHyperlink,
  TabStopType, TabStopPosition, HeadingLevel, BorderStyle, PageNumber,
} = require("docx");

const TEST_COUNT = "811";
const FILE_COUNT = "63";
const EVAL_CASES = "27";

const ACCENT = "1F4E5F";

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 140 },
    ...opts.para,
    children: [new TextRun({ text, size: 22, ...opts.run })],
  });
}
function runs(children, opts = {}) {
  return new Paragraph({ spacing: { after: 140 }, ...opts, children });
}
function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}
function t(text, bold = false) {
  return new TextRun({ text, size: 22, bold });
}

const link = (text, url) =>
  new ExternalHyperlink({
    children: [new TextRun({ text, size: 22, style: "Hyperlink" })],
    link: url,
  });

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Arial", color: ACCENT },
        paragraph: { spacing: { before: 300, after: 160 }, outlineLevel: 0 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [runs([
          new TextRun({ text: "TTB Label Verifier", size: 18, color: "667788" }),
          new TextRun({ text: "\tSubmission documentation", size: 18, color: "667788" }),
        ], { tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }], spacing: { after: 0 } })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Page ", size: 18, color: "667788" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "667788" }),
          ],
        })],
      }),
    },
    children: [
      // ---- Title block ----
      new Paragraph({
        spacing: { before: 200, after: 60 },
        children: [new TextRun({ text: "TTB Label Verifier", size: 44, bold: true, color: ACCENT })],
      }),
      new Paragraph({
        spacing: { after: 240 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
        children: [new TextRun({ text: "Approach and design", size: 26, color: "445566" })],
      }),
      runs([
        t("Matthew Nolan", true),
        new TextRun({ text: "   ·   June 2026   ·   ", size: 22 }),
        link("live demo", "https://ttb-label-verifier-matthew-nolan-s-projects.vercel.app"),
        new TextRun({ text: "   ·   ", size: 22 }),
        link("github.com/Mjnolan91/ttb-label-verifier", "https://github.com/Mjnolan91/ttb-label-verifier"),
      ], { spacing: { after: 220 } }),

      // ---- 1. Summary ----
      h1("1.  Summary"),
      p("A compliance agent at TTB, the Alcohol and Tobacco Tax and Trade Bureau, uploads photos of an alcohol label. A vision model reads them into the full set of TTB-required fields, and deterministic code checks the label against the application and against TTB's rules, field by field: brand name, alcohol content within the legal tolerance for its class, the statutory government warning word for word, and the rest. The verdict is Approve, Needs review, or Reject, with a card per field saying how it was compared and why. A batch screen runs the same engine over a few hundred labels at once; every read exports as JSON or CSV."),
      p("You can check this yourself in two minutes. Open the live demo, click \"Load the sample label\", accept the AI's suggestions, and a real front-and-back spirits pair reads as one product and lands on Approve. Load the defective-warning version and the same flow ends in Reject, citing 27 CFR 16.22(a)(2), because that back label prints the warning prefix in title case. That is the exact rejection one of the interviewed agents described, reproduced live."),
      p("Three numbers carried the design. The suite is " + TEST_COUNT + " tests that run offline in seconds with no API keys. CI fails the build if approve precision drops below 98 percent on the " + EVAL_CASES + " labeled cases (it scores 100 today), because a false approval is the one error I decided this tool would not ship: an unnecessary review costs an agent minutes, a false approval costs the tool its trust. And the deployed demo measured a 3.1-second median (5.2 at p95) against the brief's five-second ceiling; the bundled clean pair runs six to nine seconds, and the defective pair closer to thirteen, because the tool takes one zoomed look at the warning before committing to a hard Reject."),

      // ---- 2. What the customers said they wanted ----
      h1("2.  What the customers said they wanted"),
      p("Four voices run through the discovery notes, and each one set a requirement I treated as hard."),
      runs([t("Sarah, the Deputy Director", true), t(", said results must come back in about five seconds: the previous scanning vendor took 30 to 40 seconds per label and was abandoned. Her agents range from fresh graduates to a 73-year-old she considers the benchmark user, and importers dump 200 to 300 applications at once.")]),
      runs([t("Marcus, in IT", true), t(", explained that the outbound firewall had blocked the last vendor's ML endpoints, that they are an Azure shop, and that this prototype should stand alone, with no PII stored and no integration with COLA (TTB's label-approval filing system).")]),
      runs([t("Dave, a 28-year agent", true), t(", gave the false-rejection warning: STONE'S THROW and Stone's Throw are obviously the same product, and a tool doing rigid pattern matching would flood his queue with false rejections.")]),
      runs([t("Jenny, a junior agent", true), t(", described the strictest check: the government warning must match the statute word for word, with GOVERNMENT WARNING: in capital letters and bold; title case gets rejected. And badly photographed labels are out of scope but should fail gracefully.")]),
      p("So: a five-second budget, a screen a 73-year-old can use without hunting, batch at importer scale, extraction that survives the firewall, tolerant brand matching, a strict warning check, and graceful failure on bad photos. Jenny's last line became the error model for the whole tool. It is allowed to say it is not sure; it is never allowed to be silently wrong."),

      // ---- 3. How I implemented it ----
      h1("3.  How I implemented it"),
      runs([t("AI extracts, code decides. ", true), t("The vision model has exactly one job: transcribe the label images into structured fields, each with a confidence. Every pass, review, or fail after that is plain, unit-tested TypeScript: comparators tolerant of case and punctuation (STONE'S THROW and Stone's Throw compare equal, and a near miss routes to review, not reject), a completeness matrix for what each beverage class must carry, and the statutory constants (the 27 CFR 16.21 warning text, the per-class alcohol tolerances) in one hand-verified module guarded by tests. A rejection therefore cites a rule, not a model's opinion.")]),
      runs([t("Trust is measured, not assumed. ", true), t("Each product is read several times in parallel (front and back ride one request, so the model sees the panels together), and a field's confidence is the fraction of reads that agree. Anything still doubtful gets a bounded escalation: a stronger model re-reads exactly the doubtful fields, a dedicated judge decides whether the warning prefix is truly bold, and a missing warning gets one zoomed look at a cropped, straightened patch of the label. An escalation may clear a false alarm; none may flip a conflict to pass.")]),
      runs([t("The screens stay out of the way. ", true), t("The single screen leads with the application comparison, per the brief. The AI's reading pre-fills every input as a gray suggestion accepted with Tab or one click, which removes the hand re-keying of label fields; one screen, nothing to hunt for, which was the 73-year-old test. A suggestion counts only once a person accepts it, so the model never approves its own work. Batch runs the same engine over a folder of images: fronts and backs pair by filename, and an optional CSV supplies claimed values. Rows stream into a reviewable worklist with automatic retries and a delayed second look at exactly the fields a clean read missed; a header toggle switches between the two screens.")]),
      runs([t("Offline and deterministic. ", true), t("The default provider is a mock keyed off fixture filenames, so the " + TEST_COUNT + " tests in " + FILE_COUNT + " files and the " + EVAL_CASES + "-case eval run in seconds with zero keys, and CI runs the same gate (typecheck, lint, test, eval, build) on every push to main. Clone the repo, and npm test proves the whole pipeline on your laptop.")]),

      // ---- 4. Why I chose this architecture ----
      h1("4.  Why I chose this architecture"),
      runs([t("The AI models: a fast reader and an expensive judge. ", true), t("The demo runs OpenAI gpt-4.1 for extraction and gpt-5.5 only for the narrow judgments (the bold-prefix call, the focused re-reads). I measured the obvious alternative, running everything on the strongest model: identical verdicts, the median more than doubled (2.8 to 6.5 seconds), and the same experiment on Gemini failed 4 of its 9 requests on the Pro model's per-minute quota at that key's tier. Sarah's five-second ceiling made that decisive. Transcription is what current vision models are reliably good at, so the cheap model does the volume work and the expensive one is spent where a single judgment can hard-fail a label. The split held on both vendors I measured, and I trust sampling agreement over any model's self-reported confidence, so the trust mechanism itself is vendor-neutral.")]),
      runs([t("A provider interface, because vendor lock-in already failed here once. ", true), t("The last vendor died at Marcus's firewall, so coupling to one endpoint was a stated failure mode, not a hypothetical. Extraction sits behind one VisionProvider interface with six modes: mock, OpenAI, Gemini, Azure OpenAI, Azure Document Intelligence, and an ensemble that routes cross-provider disagreement to review. Production would point at the in-tenant Azure providers (the same model family, inside the tenant the firewall trusts); the public demo runs on a single OpenAI key; switching is an env-var change. The offline mock is the quiet workhorse of the design: it is what makes every test deterministic and lets a reviewer run the entire suite with no keys and no network.")]),
      runs([t("Why Next.js. ", true), t("The honest alternatives were a React SPA with a separate API service, or a Python backend for the model calls. Both mean two deployables, two type systems, and API keys living in a second codebase. Next.js collapses that: one strict-TypeScript codebase where route handlers run the pipeline server-side (keys never reach the browser), server components render the screens, and the extracted-field shape is one set of types shared by the pipeline, the UI, and the CSV export, so the field list cannot drift between layers. The standalone build ships as a small container for the Azure target. It is also deliberately boring: a reviewer finds the API route and the page exactly where Next.js puts them. I wanted the plumbing unremarkable so the thinking worth reviewing could live in the domain logic.")]),
      runs([t("The rest of the stack, briefly. ", true), t("TypeScript strict, because compliance code is exactly where an implicit any hides a bug. Tailwind, because the accessibility rules (4.5:1 contrast in both themes, 44-pixel targets, visible focus) are tokens applied at the point of use, where a stylesheet that drifts from its markup cannot hide. Vitest, because a suite that finishes in about five seconds gets run on every save, and a suite that gets run is the only kind that helps. sharp is the one extra runtime dependency, for the server-side crop and upscale behind the warning check. And no database, on purpose: Marcus said standalone with no PII, so nothing is stored and there is nothing to secure, back up, or migrate.")]),
      runs([t("Why Vercel for the demo, Azure for production. ", true), t("I wanted a reviewer inside the running app one click after opening the repo, and Vercel auto-deploys this repo's main branch with zero configuration. It is only the demo host: the firewall requirement points production at in-tenant Azure, which is why the repo ships a multi-stage Dockerfile with documented App Service and Container Apps paths. Vercel is the shortest path to a working demo in your browser; Azure is where it would actually live.")]),
      runs([t("Deterministic comparators, because the verdict must survive an audit. ", true), t("A compliance verdict has to be auditable and reproducible. \"The model felt the brand matched\" is not an answer a government reviewer can act on, so the model never makes the final call.")]),
      runs([t("What I would do next. ", true), t("Deploy the container in-tenant with provisioned model quota behind the agency gateway (authentication and rate limiting), then layout-preserving OCR to unlock the type-size and placement rules that text-only extraction cannot check, then a sampled human-audit loop over auto-approvals so the false-approval rate keeps getting measured once real labels flow through it. COLA integration goes last; reaching that system is procurement work before it is engineering work.")]),
      p("One pattern runs through all of it: decide by measurement, gate the build on the error class you refuse to ship, and route uncertainty to people."),
    ],
  }],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT_PATH, buffer);
  console.log("Wrote " + OUT_PATH + " (" + buffer.length + " bytes)");
});
