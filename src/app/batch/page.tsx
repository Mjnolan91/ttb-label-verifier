import Link from "next/link";
import { BatchVerify } from "./BatchVerify";
import { linkClass } from "../ui/fieldStyles";

export default function BatchPage() {
  // Same calm "demo mode" hint as the single screen, so a reviewer who lands on /batch in the offline
  // mock isn't surprised that their own photos can't be read. A configured real provider hides it.
  const mockMode = (process.env.VISION_PROVIDER ?? "mock").toLowerCase() === "mock";
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-4 py-10 sm:py-14 focus:outline-none">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">
          TTB compliance · prototype
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight text-ink">Batch label reading</h1>
        <p className="mt-3 text-lg text-ink-muted">
          Read many labels at once into a JSON/CSV export — built for the big-importer drops of
          200–300 at a time. For one label,{" "}
          <Link href="/" className={linkClass}>
            use the single-label screen
          </Link>
          .
        </p>
      </header>

      <BatchVerify mockMode={mockMode} />
    </main>
  );
}
