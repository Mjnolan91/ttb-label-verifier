import Link from "next/link";
import { BatchVerify } from "./BatchVerify";

export default function BatchPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-4 py-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Batch verification</h1>
        <p className="mt-2 text-lg text-slate-700">
          Verify many labels at once. For one label,{" "}
          <Link
            href="/"
            className="font-semibold text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            use the single-label screen
          </Link>
          .
        </p>
      </header>

      <BatchVerify />
    </main>
  );
}
