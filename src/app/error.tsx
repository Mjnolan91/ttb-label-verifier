"use client";

/**
 * Route error boundary (US-008) — ensures an unexpected render/runtime error shows a friendly,
 * recoverable message instead of a blank/crashed page. "No uncaught error crashes the page."
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Something went wrong</h1>
      <p className="text-slate-700">
        An unexpected error occurred. Nothing was saved — please try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="min-h-[44px] rounded-lg bg-blue-700 px-5 font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
      >
        Try again
      </button>
    </main>
  );
}
