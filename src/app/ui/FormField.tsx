/**
 * FormField — label + (optional hint) + control, wired together so a11y can't drift: the visible
 * "(required)"/"(optional)" suffix is text (not color), and the label is associated via htmlFor.
 * The control is passed as children and keeps its own aria-required/aria-describedby.
 */
import type { ReactNode } from "react";

export function FormField({
  label,
  htmlFor,
  required = false,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block font-medium text-ink">
        {label} <span className="font-normal text-ink-muted">({required ? "required" : "optional"})</span>
      </label>
      {hint && <p className="mb-1.5 text-sm text-ink-muted">{hint}</p>}
      {children}
    </div>
  );
}
