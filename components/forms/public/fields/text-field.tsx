"use client";

import { FieldShell, publicInputClass, type FieldProps } from "./shared";

const text = (value: unknown) => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));

export function ShortTextField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="text"
          className={publicInputClass}
          value={text(value)}
          placeholder={field.placeholder}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
          maxLength={500}
        />
      )}
    </FieldShell>
  );
}

export function LongTextField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          rows={4}
          className={publicInputClass}
          value={text(value)}
          placeholder={field.placeholder}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
          maxLength={5000}
        />
      )}
    </FieldShell>
  );
}

export function EmailField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          className={publicInputClass}
          value={text(value)}
          placeholder={field.placeholder || "correo@ejemplo.com"}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

export function PhoneField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className={publicInputClass}
          value={text(value)}
          placeholder={field.placeholder || "+506 8888 1234"}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

export function NumberField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className={publicInputClass}
          value={text(value)}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

export function DateField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="date"
          className={publicInputClass}
          value={text(value)}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}
