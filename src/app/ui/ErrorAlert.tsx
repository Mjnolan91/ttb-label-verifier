/**
 * ErrorAlert — one accessible error treatment (role="alert", icon + message). Keeps the optional
 * `id` so callers can wire it to a control via aria-describedby (as the verify button does).
 */
import type { ReactNode } from "react";
import { IconFail } from "./icons";

export function ErrorAlert({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      id={id}
      role="alert"
      className={`flex items-start gap-2 rounded-field border-2 border-fail-700 bg-fail-50 px-3 py-2.5 font-medium text-fail-900 ${className}`}
    >
      <IconFail className="mt-0.5 h-5 w-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
