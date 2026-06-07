/**
 * ResultSkeleton — placeholder shown while a verification is in flight. Decorative (aria-hidden):
 * the spoken "Verifying label…" status lives in an aria-live region in VerifyForm. The pulse is
 * gated by the global reduced-motion guard.
 */
export function ResultSkeleton() {
  return (
    <div aria-hidden="true" className="mt-6 flex flex-col gap-4">
      <div className="h-[5.5rem] rounded-card bg-surface-sunken motion-safe:animate-pulse" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-card bg-surface-sunken motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}
