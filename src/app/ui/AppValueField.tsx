"use client";

/**
 * AppValueField — the one editable control for an application value, on both screens.
 *
 * It is a single-row textarea styled exactly like the text inputs it replaces, because a long
 * value (an address, a statement of composition, a long suggestion) must WRAP and stay fully
 * readable and cursor-navigable. A single-line <input> clips text past the box edge, and a long
 * grey PLACEHOLDER suggestion there cannot be read at all (a placeholder is not text; the caret
 * cannot traverse it). Wrapping solves both: the field grows to fit whatever it shows.
 *
 * Application values are single logical lines (they come from labels and CSV cells), so Enter is
 * a no-op and pasted newlines collapse to spaces — the textarea is a presentation choice, never a
 * multi-line value editor. Growth is synced to scrollHeight after render; min-height keeps the
 * 44px target when empty.
 */
import { forwardRef, useEffect, useRef, type KeyboardEvent } from "react";

export const AppValueField = forwardRef<
  HTMLTextAreaElement,
  {
    id: string;
    value: string;
    onValueChange: (value: string) => void;
    placeholder?: string;
    required?: boolean;
    "aria-describedby"?: string;
    className: string;
    /** Runs after the Enter guard (the single screen's Tab-to-accept hook). */
    onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  }
>(function AppValueField({ id, value, onValueChange, placeholder, required, className, onKeyDown, ...aria }, ref) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow to fit the rendered content (value or wrapped placeholder) on every paint. "auto" first
  // so the field also SHRINKS when text is deleted; min-h in the className keeps the floor.
  // scrollHeight is the PADDING box; with border-box sizing the style height must also cover the
  // borders (offsetHeight - clientHeight), or the last line sits clipped by the border width.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  });

  return (
    <textarea
      ref={(el) => {
        innerRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      id={id}
      rows={1}
      value={value}
      onChange={(e) => onValueChange(e.target.value.replace(/\s*\r?\n\s*/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault(); // single logical line; Enter must not grow the value
        onKeyDown?.(e);
      }}
      placeholder={placeholder}
      required={required}
      aria-required={required || undefined}
      aria-describedby={aria["aria-describedby"]}
      className={`${className} resize-none overflow-hidden`}
    />
  );
});
