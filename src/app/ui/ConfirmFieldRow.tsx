import { useId } from "react";
import type { ConfirmFieldResult } from "@/compare";
import { StatusBadge } from "./StatusBadge";
import { TONE_TINT, TONE_ICON, FIELD_LABEL } from "./status";
import { inputClass } from "./fieldStyles";

/**
 * ConfirmFieldRow — one TTB-required element the agent confirms or corrects.
 *
 * The input holds the AI's reading. When the AI read a value, pressing Tab on it unchanged (or the
 * visible ✓ Confirm button) accepts it ("matches the application"); editing re-runs that field's
 * comparator. "Not on the label" marks the element absent (a mandatory one -> reject). An empty
 * (not-read) field shows no Confirm — there is nothing to confirm. The government warning is not
 * editable (auto-evaluated, statutory) and renders its status only.
 */
export function ConfirmFieldRow({
  field,
  onAccept,
  onEdit,
  onMarkMissing,
}: {
  field: ConfirmFieldResult;
  onAccept: () => void;
  onEdit: (value: string) => void;
  onMarkMissing: () => void;
}) {
  const inputId = useId();
  const tone = field.status; // pass | review | fail
  const Icon = TONE_ICON[tone];
  const hasAiValue = field.aiValue.trim() !== "";
  const confirmed = field.state !== "unconfirmed";

  return (
    <li className={`rounded-card border-l-4 p-4 shadow-card ${TONE_TINT[tone]}`}>
      <div className="flex flex-wrap items-center gap-2">
        {Icon && <Icon className="h-5 w-5 shrink-0" />}
        <span className="font-semibold">{field.label}</span>
        {field.necessity === "conditional" && (
          <span className="text-xs text-ink-muted" title="Required only in certain cases">
            (only if it applies)
          </span>
        )}
        <StatusBadge tone={tone} label={FIELD_LABEL[field.status]} className="ml-auto" />
      </div>

      {field.editable && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label
              htmlFor={inputId}
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              {field.label}{" "}
              {typeof field.confidence === "number" && (
                <span className="font-normal normal-case">
                  — AI {Math.round(field.confidence * 100)}% sure
                </span>
              )}
            </label>
            <input
              id={inputId}
              className={inputClass}
              value={field.value}
              placeholder="(not read — type it if it's on the label)"
              onChange={(e) => onEdit(e.target.value)}
              onKeyDown={(e) => {
                // Tab accepts the AI reading when it exists and the agent hasn't changed it
                // (the "grey field" accelerator).
                if (e.key === "Tab" && !e.shiftKey && hasAiValue && field.state === "unconfirmed") {
                  onAccept();
                }
              }}
            />
          </div>
          <div className="flex gap-2">
            {hasAiValue && (
              <button
                type="button"
                aria-label={`Confirm ${field.label}`}
                onClick={onAccept}
                className="min-h-[44px] rounded-field border-2 border-pass-600 px-3 text-sm font-semibold text-pass-900 hover:bg-pass-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
              >
                {confirmed ? "✓ Confirmed" : "✓ Confirm"}
              </button>
            )}
            <button
              type="button"
              aria-label={`Mark ${field.label} as not on the label`}
              onClick={onMarkMissing}
              className="min-h-[44px] rounded-field border-2 border-border-strong px-3 text-sm font-semibold text-ink hover:border-fail-600 hover:text-fail-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              Not on the label
            </button>
          </div>
        </div>
      )}

      {field.reason && <p className="mt-2 break-words text-sm">{field.reason}</p>}
    </li>
  );
}
