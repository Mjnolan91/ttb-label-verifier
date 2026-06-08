import Link from "next/link";
import { APP_TITLE } from "./constants";
import { VerifyForm } from "./VerifyForm";
import { cardClass, linkClass } from "./ui/fieldStyles";
// Single source of truth: the canonical warning shown as a reference comes from src/domain.
import { CANONICAL_GOVERNMENT_WARNING, GOVERNMENT_WARNING_PREFIX } from "@/domain";

const WARNING_REMAINDER = CANONICAL_GOVERNMENT_WARNING.slice(GOVERNMENT_WARNING_PREFIX.length);

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-10 sm:py-14">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">
          TTB compliance · prototype
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight text-ink">{APP_TITLE}</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-muted">
          Drop in a product&apos;s label images — front, back, neck — and the AI reads them together
          into the full set of TTB-required fields, then checks the label for completeness against
          TTB&apos;s requirements for its beverage type. Export as JSON or CSV. No typing.
        </p>
        <p className="mt-3">
          <Link href="/batch" className={linkClass}>
            Reading many labels at once? Use batch mode →
          </Link>
        </p>
      </header>

      <VerifyForm />

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
