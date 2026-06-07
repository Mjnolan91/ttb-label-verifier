import Link from "next/link";
import { APP_TITLE } from "./constants";
import { VerifyForm } from "./VerifyForm";
// Single source of truth: the canonical warning shown as a reference comes from src/domain.
import { CANONICAL_GOVERNMENT_WARNING, GOVERNMENT_WARNING_PREFIX } from "@/domain";

const WARNING_REMAINDER = CANONICAL_GOVERNMENT_WARNING.slice(
  GOVERNMENT_WARNING_PREFIX.length,
);

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{APP_TITLE}</h1>
        <p className="mt-2 text-lg text-slate-700">
          Upload a label image and the claimed application values to check the brand name,
          alcohol content, and the government health warning.
        </p>
        <p className="mt-2">
          <Link
            href="/batch"
            className="font-semibold text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            Verifying many labels? Use batch mode →
          </Link>
        </p>
      </header>

      <VerifyForm />

      <details className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-slate-800">
          What we check the warning against (27 CFR 16.21)
        </summary>
        <blockquote className="mt-3 border-l-4 border-slate-300 bg-slate-50 p-4 leading-relaxed text-slate-700">
          <strong className="font-bold text-slate-900">{GOVERNMENT_WARNING_PREFIX}</strong>
          {WARNING_REMAINDER}
        </blockquote>
      </details>
    </main>
  );
}
