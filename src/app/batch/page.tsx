import Link from "next/link";
import { BatchVerify } from "./BatchVerify";
import { linkClass } from "../ui/fieldStyles";

export default function BatchPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-4 py-10 sm:py-14">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">
          TTB compliance · prototype
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight text-ink">Batch verification</h1>
        <p className="mt-3 text-lg text-ink-muted">
          Verify many labels at once. For one label,{" "}
          <Link href="/" className={linkClass}>
            use the single-label screen
          </Link>
          .
        </p>
      </header>

      <BatchVerify />
    </main>
  );
}
