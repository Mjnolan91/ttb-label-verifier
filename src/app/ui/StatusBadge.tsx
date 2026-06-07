/**
 * StatusBadge — the solid status pill (icon + text), used in result field cards, the batch table,
 * and the sample buttons. Always renders the text label; the icon is decorative.
 */
import { TONE_SOLID, TONE_ICON, type Tone } from "./status";

export function StatusBadge({
  tone,
  label,
  className = "",
}: {
  tone: Tone;
  label: string;
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-bold ${TONE_SOLID[tone]} ${className}`}
    >
      {Icon && <Icon className="text-[0.95em]" />}
      {label}
    </span>
  );
}
