import { APP_TITLE } from "./constants";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {APP_TITLE}
        </h1>
        <p className="mt-3 text-lg text-slate-600">
          Verify a label image against the values claimed in an application.
        </p>
      </section>
    </main>
  );
}
