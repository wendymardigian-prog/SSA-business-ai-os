"use client";

import { X } from "lucide-react";
import { checkClientFiles } from "@/lib/forms/public-client";
import { FieldShell, publicInputClass, type FieldProps } from "./shared";

const MIME_LABELS: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
};

export function describeAccepted(accept: string[]): string {
  return [...new Set(accept.map((m) => MIME_LABELS[m] ?? m))].join(", ");
}

export function FileField({ field, error, locked, files = [], onFiles, onInteract }: FieldProps) {
  const rule = field.file;
  const hint = rule ? `${describeAccepted(rule.accept)} · hasta ${rule.maxMb} MB${rule.maxFiles > 1 ? ` · hasta ${rule.maxFiles} archivos` : ""}` : undefined;

  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <div className="space-y-2">
          <input
            id={id}
            type="file"
            className={publicInputClass}
            accept={rule?.accept.join(",")}
            multiple={(rule?.maxFiles ?? 1) > 1}
            disabled={locked}
            aria-describedby={describedBy}
            aria-invalid={!!error}
            onFocus={onInteract}
            onChange={(e) => {
              const chosen = Array.from(e.target.files ?? []);
              onFiles?.(chosen);
              e.target.value = "";
            }}
          />
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          {files.length > 0 && (
            <ul className="space-y-1">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-xs">
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label={`Quitar ${file.name}`}
                    onClick={() => onFiles?.(files.filter((_, i) => i !== index))}
                    className="ml-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {files.length > 0 && checkClientFiles({ file: rule, required: false }, files) && (
            <p className="text-xs text-destructive">{checkClientFiles({ file: rule, required: false }, files)}</p>
          )}
        </div>
      )}
    </FieldShell>
  );
}
