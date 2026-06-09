"use client";

/**
 * Route error boundary — ensures an unexpected render/runtime error shows a friendly,
 * recoverable message instead of a blank/crashed page. "No uncaught error crashes the page."
 */
import { primaryButtonClass } from "./ui/fieldStyles";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <h1 className="text-2xl font-bold text-ink">Something went wrong</h1>
      <p className="text-ink-muted">An unexpected error occurred. Nothing was saved, so please try again.</p>
      <button type="button" onClick={reset} className={primaryButtonClass}>
        Try again
      </button>
    </main>
  );
}
