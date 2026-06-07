"use client";

/**
 * DropZone — drag-and-drop wrapping a real (keyboard-focusable) file input, with an upload icon and
 * live preview. A11y: the real <input> stays the focusable element (sr-only but present), the
 * wrapper shows a visible focus-within ring, the <label htmlFor> association keeps click+keyboard
 * working, and aria-describedby is forwarded. Drag is a progressive enhancement over the picker.
 */
import { useState, type ChangeEvent, type DragEvent, type Ref } from "react";
import { IconUpload } from "./icons";

export function DropZone({
  id,
  file,
  preview,
  onFile,
  inputRef,
  describedById,
  accept = "image/*",
}: {
  id: string;
  file: File | null;
  preview: string | null;
  onFile: (f: File | undefined) => void;
  inputRef?: Ref<HTMLInputElement>;
  describedById?: string;
  accept?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
      }}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        onFile(e.dataTransfer.files?.[0]);
      }}
      className={
        "rounded-card border-2 border-dashed p-6 text-center transition-colors focus-within:outline-none " +
        "focus-within:ring-2 focus-within:ring-brand-700 focus-within:ring-offset-2 " +
        (dragOver
          ? "border-brand-600 bg-brand-50"
          : "border-border-strong bg-surface-muted hover:border-brand-500 hover:bg-brand-50")
      }
    >
      <label htmlFor={id} className="flex cursor-pointer flex-col items-center gap-2">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a remote asset
          <img
            src={preview}
            alt={file ? `Preview of ${file.name}` : "Selected label preview"}
            className="mx-auto mb-1 max-h-60 w-auto rounded-lg border border-border bg-white object-contain shadow-sm"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-2xl text-brand-600"
          >
            <IconUpload />
          </span>
        )}
        <span className="font-semibold text-ink">
          {file ? `Selected: ${file.name}` : "Drag & drop a label image"}
        </span>
        <span className="text-sm text-ink-muted">
          or <span className="font-semibold text-brand-700 underline underline-offset-2">browse for a file</span>
        </span>
        <input
          ref={inputRef}
          id={id}
          name="image"
          type="file"
          accept={accept}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onFile(e.target.files?.[0])}
          aria-required="true"
          aria-describedby={describedById}
          className="sr-only"
        />
      </label>
    </div>
  );
}
