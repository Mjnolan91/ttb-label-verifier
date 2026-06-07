import { APP_TITLE } from "./constants";
// Single source of truth: the canonical warning + prefix come from the CFR-verified
// domain module (src/domain), imported through the "@/..." path alias. Never re-declare
// these constants in the UI layer.
import {
  CANONICAL_GOVERNMENT_WARNING,
  GOVERNMENT_WARNING_PREFIX,
} from "@/domain";

// Display-only split so the mandatory prefix can be shown bold (27 CFR 16.22(a)(2)) while
// the remainder is regular weight — derived from the constant, not a second copy of the text.
const WARNING_REMAINDER = CANONICAL_GOVERNMENT_WARNING.slice(
  GOVERNMENT_WARNING_PREFIX.length,
);

const CHECKS = [
  {
    name: "Brand name",
    detail:
      "Tolerant match — case, spacing, punctuation and smart quotes are normalized before comparing.",
  },
  {
    name: "Alcohol content",
    detail:
      "ABV (and proof = 2 × ABV) checked against the CFR tolerance selected by the beverage class.",
  },
  {
    name: "Government health warning",
    detail:
      "Strict, word-for-word match against the federal statutory text, including the ALL-CAPS bold prefix.",
  },
] as const;

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-3xl font-bold tracking-tight text-slate-900">
          {APP_TITLE}
        </h1>
        <p className="mt-3 text-center text-lg text-slate-600">
          Verify a label image against the values claimed in an application.
        </p>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
          The three checks
        </h2>
        <ul className="mt-3 space-y-3">
          {CHECKS.map((check) => (
            <li key={check.name} className="rounded-lg bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">{check.name}</p>
              <p className="mt-1 text-sm text-slate-600">{check.detail}</p>
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Canonical government warning
        </h2>
        <blockquote className="mt-3 border-l-4 border-slate-300 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
          <strong className="font-bold text-slate-900">
            {GOVERNMENT_WARNING_PREFIX}
          </strong>
          {WARNING_REMAINDER}
        </blockquote>
        <p className="mt-2 text-xs text-slate-500">
          27 CFR 16.21 — the exact text every label is checked against.
        </p>
      </section>
    </main>
  );
}
