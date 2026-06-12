"use client";

/**
 * ModeToggle — the header control that switches between the two screens: the single verify
 * screen (/) and the batch worklist (/batch). Always points at the OTHER mode and is labeled by
 * destination (the ThemeToggle convention: the control names where it takes you, not where you
 * are). Navigation, so it renders a styled next/link, not a button: middle-click, cmd-click, and
 * "open in new tab" must keep working.
 *
 * Self-contained client leaf for the same reason as HelpButton/ThemeToggle (layout.tsx stays a
 * server component): this control needs usePathname() to know which screen is showing. Any
 * /batch subpath counts as batch mode; every other route offers batch.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBatch, IconSingle } from "./icons";

export function ModeToggle() {
  const path = usePathname() ?? "";
  const onBatch = path === "/batch" || path.startsWith("/batch/");
  return (
    <Link
      href={onBatch ? "/" : "/batch"}
      aria-label={onBatch ? "Switch to single-label mode" : "Switch to batch mode"}
      className="inline-flex min-h-[40px] items-center gap-2 rounded-field border border-border bg-surface px-3 text-sm font-semibold text-ink shadow-sm transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
    >
      {onBatch ? <IconSingle className="h-5 w-5" /> : <IconBatch className="h-5 w-5" />}
      <span className="hidden sm:inline">{onBatch ? "Single" : "Batch"}</span>
    </Link>
  );
}
