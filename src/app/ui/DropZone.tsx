"use client";

/**
 * DropZone — drag-and-drop / file-picker for one or more label images (a product may have front,
 * back, neck images). A11y: a real keyboard-focusable <input> (sr-only) wrapped in a <label>, a
 * visible focus-within ring, and forwarded aria-describedby. The selected images are rendered by the
 * caller (so it can show thumbnails + per-image position). The input value is reset after each pick
 * so re-selecting the same file still fires.
 */
import { useState, type ChangeEvent, type DragEvent, type Ref } from "react";
import { IconUpload } from "./icons";

export function DropZone({
  id,
  onFiles,
  inputRef,
  describedById,
  ariaLabel,
  accept = "image/*",
  multiple = true,
}: {
  id: string;
  onFiles: (files: File[]) => void;
  inputRef?: Ref<HTMLInputElement>;
  describedById?: string;
  /** Accessible name for the file input — distinguishes otherwise-identical drop targets (e.g. Front vs Back). */
  ariaLabel?: string;
  accept?: string;
  multiple?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const handle = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    if (files.length > 0) onFiles(files);
  };
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
        handle(e.dataTransfer.files);
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
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-2xl text-brand-600"
        >
          <IconUpload />
        </span>
        <span className="font-semibold text-ink">
          Drag &amp; drop label image{multiple ? "s" : ""}
        </span>
        <span className="text-sm text-ink-muted">
          or <span className="font-semibold text-brand-700 underline underline-offset-2">browse</span>
          {multiple ? " (front, back, neck…)" : ""}
        </span>
        <input
          ref={inputRef}
          id={id}
          name="image"
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            handle(e.target.files);
            e.target.value = "";
          }}
          aria-required="true"
          aria-label={ariaLabel}
          aria-describedby={describedById}
          className="sr-only"
        />
      </label>
    </div>
  );
}
