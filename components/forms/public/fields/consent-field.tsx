"use client";

import { FieldShell, type FieldProps } from "./shared";

export function ConsentField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked} inline>
      {({ id, describedBy }) => (
        <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            className="mt-0.5"
            checked={value === true}
            disabled={locked}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            onFocus={onInteract}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            {field.consentText || field.label}
            {field.required && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}
          </span>
        </label>
      )}
    </FieldShell>
  );
}
