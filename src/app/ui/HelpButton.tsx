"use client";

/**
 * HelpButton — the header "?" control. Opens the in-app help panel in the shared accessible Drawer
 * (dialog semantics, focus trap, Escape/backdrop close, background inerted, focus returned).
 *
 * Self-contained client leaf so layout.tsx stays a server component (it exports `metadata`, which is
 * illegal in a client component) — same boundary pattern as ThemeToggle. The content is short and
 * behavior-level on purpose: how to verify, what the verdicts mean, and the three bundled sample
 * labels with their expected outcomes (the same files the verify screen offers), so a first-time
 * reviewer has a working script without leaving the screen.
 */
import { useState } from "react";
import { Drawer } from "./Drawer";
import { IconHelp } from "./icons";
import { linkClass } from "./fieldStyles";

/** The bundled sample product (a real front/back spirits pair) and its one defect variant. */
const SAMPLES: { name: string; expect: string; detail: string; files: { href: string; label: string }[] }[] = [
  {
    name: "Fear the Dragon, the clean pair",
    expect: "Approve",
    files: [
      { href: "/samples/fear-the-dragon-front.jpg", label: "front label" },
      { href: "/samples/fear-the-dragon-back.jpg", label: "back label" },
    ],
    detail:
      "A real spirits label read as one product: select both files at once and they place " +
      "themselves. The brand and alcohol read from the front, the net contents and the government " +
      "warning from the back, and every field matches the application.",
  },
  {
    name: "Non-bold government warning",
    expect: "Reject",
    files: [{ href: "/samples/fear-the-dragon-warning-not-bold-back.jpg", label: "edited back label" }],
    detail:
      'Upload the same front with this back: the warning text is word-for-word correct and all ' +
      'caps, but the "GOVERNMENT WARNING:" prefix is printed in regular weight. 27 CFR ' +
      "16.22(a)(2) requires it in bold type, a hard fail. (An edited test image; the real " +
      "product's label is compliant.)",
  },
];

function SectionTitle({ children }: { children: string }) {
  return <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-muted">{children}</h3>;
}

export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Help"
        className="inline-flex min-h-[40px] items-center gap-2 rounded-field border border-border bg-surface px-3 text-sm font-semibold text-ink shadow-sm transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      >
        <IconHelp className="h-5 w-5" />
        <span className="hidden sm:inline">Help</span>
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Help" closeLabel="Close help">
        <div className="text-sm leading-relaxed text-ink">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            How to verify a label
          </h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>
              Upload the front label photo, plus the back and a neck or strip label if there is one.
              You can select several photos at once; filenames ending in -front, -back, or -neck
              place themselves. The AI reads the images automatically.
            </li>
            <li>
              Fill in <strong>The application</strong>: what the applicant claims. The AI&apos;s
              reading is suggested in gray. Press Tab to accept a field, or use Accept all AI
              suggestions, or type the application&apos;s values.
            </li>
            <li>
              Once every field TTB requires for the beverage type is filled, the screen compares the
              label against the application field by field and shows the verdict.
            </li>
            <li>
              Record your decision: Approve COLA or Reject / send back. The email to the applicant
              is drafted from your review notes (demo only; no email is actually sent).
            </li>
          </ol>

          <SectionTitle>What the verdicts mean</SectionTitle>
          <ul className="mt-2 space-y-2">
            <li>
              <strong>Approve.</strong> Every compared field matches the label and the label carries
              all elements TTB requires for its beverage type.
            </li>
            <li>
              <strong>Needs review.</strong> A near miss, a low-confidence read, or anything the
              system could not verify outright. Uncertainty always routes to a person; the system
              never auto-approves on a doubtful read. Check each flagged field against the label
              photo, then confirm or flag it; the verdict updates with your calls.
            </li>
            <li>
              <strong>Reject.</strong> A hard mismatch: a different brand name, alcohol content
              outside the legal tolerance for the class, or a defective government warning.
            </li>
          </ul>

          <SectionTitle>The supporting completeness check</SectionTitle>
          <p className="mt-2">
            Separately from the comparison, deterministic code checks that the label carries every
            element TTB requires for its beverage type (brand name, class/type designation, net
            contents, producer name and address, alcohol content where required, and the government
            warning at 0.5% ABV or above). It sits in the collapsed section under the verdict.
          </p>

          <SectionTitle>If the label can&apos;t be read</SectionTitle>
          <p className="mt-2">
            Upload a clearer, well-lit photo with the label flat and in focus. Every completed read
            can be saved with the Download JSON and Download CSV buttons under the result.
          </p>

          <SectionTitle>Try it with a sample</SectionTitle>
          <ul className="mt-2 space-y-2.5">
            {SAMPLES.map((s) => (
              <li key={s.name}>
                <span className="font-semibold">{s.name}</span> <span className="font-semibold">({s.expect})</span>
                {" : "}
                {s.files.map((f, i) => (
                  <span key={f.href}>
                    {i > 0 && " and "}
                    <a href={f.href} download className={linkClass}>
                      {f.label}
                    </a>
                  </span>
                ))}
                <span className="block text-ink-muted">{s.detail}</span>
              </li>
            ))}
          </ul>

          <SectionTitle>Many labels at once</SectionTitle>
          <p className="mt-2">
            The <a href="/batch" className={linkClass}>batch screen</a> takes a whole folder of label
            images, pairs fronts and backs by filename, and checks each product against an optional
            CSV of application values. It doubles as the review worklist. Busy-service failures retry
            automatically, your decisions and typed application values save in this browser, and the
            table downloads as JSON or CSV.
          </p>
        </div>
      </Drawer>
    </>
  );
}
