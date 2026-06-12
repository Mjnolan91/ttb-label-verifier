import Link from "next/link";
import { BatchVerify } from "./BatchVerify";
import { BackToTop } from "../ui/BackToTop";
import { linkClass } from "../ui/fieldStyles";
import { IconUsFlag } from "../ui/icons";

export default function BatchPage() {
  // Same calm "demo mode" hint as the single screen, so a reviewer who lands on /batch in the offline
  // mock isn't surprised that their own photos can't be read. A configured real provider hides it.
  const mockMode = (process.env.VISION_PROVIDER ?? "mock").toLowerCase() === "mock";
  return (
    // The asymmetric bottom padding reserves the lane BackToTop floats in, so the worklist's last
    // row is never under the pill at full scroll.
    <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-4 pt-10 pb-24 sm:pt-14 sm:pb-28 focus:outline-none">
      <header>
        {/* The eyebrow shares the top edge with the fixed header controls (mode + help + theme), so
            it alone gets right padding — same treatment as the verify page. */}
        <p className="flex items-center gap-2 pr-44 text-sm font-semibold uppercase tracking-wide text-brand-700 sm:pr-80 2xl:pr-0">
          <IconUsFlag className="h-3.5 w-auto shrink-0 rounded-[1px] shadow-sm ring-1 ring-black/10" />
          TTB compliance · prototype
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight text-ink">Batch label reading</h1>
        <p className="mt-3 text-lg text-ink-muted">
          Read many labels at once, then review and decide each one in a worklist that tracks your
          progress. Built for the big-importer drops of 200 to 300 at a time. For one label,{" "}
          <Link href="/" className={linkClass}>
            use the single-label screen
          </Link>
          .
        </p>
      </header>

      <BatchVerify mockMode={mockMode} />
      <BackToTop />
    </main>
  );
}
