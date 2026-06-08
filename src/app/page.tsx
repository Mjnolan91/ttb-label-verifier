import Link from "next/link";
import { APP_TITLE } from "./constants";
import { VerifyForm } from "./VerifyForm";
import { cardClass, linkClass } from "./ui/fieldStyles";
// Single source of truth: the canonical warning shown as a reference comes from src/domain.
import { CANONICAL_GOVERNMENT_WARNING, GOVERNMENT_WARNING_PREFIX } from "@/domain";

const WARNING_REMAINDER = CANONICAL_GOVERNMENT_WARNING.slice(GOVERNMENT_WARNING_PREFIX.length);

export default function Home() {
  // Server-side: is the offline mock the active reader? (VISION_PROVIDER unset or "mock"). Used to
  // show a calm "demo mode" hint so a first-time user isn't surprised that their own photo can't be
  // read. A configured real provider (the deployed demo) hides it. Env check avoids constructing a
  // provider here (which would throw if a real provider is selected but unconfigured).
  const mockMode = (process.env.VISION_PROVIDER ?? "mock").toLowerCase() === "mock";
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-10 sm:py-14 focus:outline-none">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">
          TTB compliance · prototype
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight text-ink">{APP_TITLE}</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-muted">
          Check a label against its application — brand, alcohol content, and the government warning →
          Approve, Needs&nbsp;review, or Reject. The AI also reads the full set of TTB-required fields
          and checks completeness for the beverage type. Export as JSON or CSV. No typing required to read.
        </p>
        <p className="mt-3">
          <Link href="/batch" className={linkClass}>
            Reading many labels at once? Use batch mode →
          </Link>
        </p>
      </header>

      <VerifyForm mockMode={mockMode} />

      <details className={`${cardClass} p-5 text-sm`}>
        <summary className="cursor-pointer font-semibold text-ink">
          What we check the warning against (27 CFR 16.21)
        </summary>
        <blockquote className="mt-3 rounded-field border-l-4 border-border bg-surface-muted p-4 leading-relaxed text-ink-muted">
          <strong className="font-bold text-ink">{GOVERNMENT_WARNING_PREFIX}</strong>
          {WARNING_REMAINDER}
        </blockquote>
      </details>
    </main>
  );
}
