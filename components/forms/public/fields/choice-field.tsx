"use client";

import { cn } from "@/lib/utils";
import { FieldShell, publicInputClass, type FieldProps } from "./shared";

/** Con pocas opciones se ven todas (radio); con muchas, un desplegable. */
const RADIO_LIMIT = 4;

export function SingleSelectField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  const options = field.options ?? [];
  const current = typeof value === "string" ? value : "";

  if (options.length <= RADIO_LIMIT) {
    return (
      <fieldset className="space-y-1.5" aria-describedby={undefined}>
        <legend className="block text-sm font-medium">
          {field.label}
          {field.required && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}
        </legend>
        <div className="space-y-2" role="radiogroup" aria-invalid={!!error}>
          {options.map((option) => (
            <label key={option} className={cn("flex cursor-pointer items-center gap-2 text-sm", locked && "pointer-events-none opacity-70")}>
              <input
                type="radio"
                name={field.key}
                value={option}
                checked={current === option}
                disabled={locked}
                onFocus={onInteract}
                onChange={() => onChange(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
        {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </fieldset>
    );
  }

  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <select
          id={id}
          className={publicInputClass}
          value={current}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Seleccioná una opción</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function MultiSelectField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  const options = field.options ?? [];
  const selected = Array.isArray(value) ? (value as string[]) : [];

  return (
    <fieldset className="space-y-1.5">
      <legend className="block text-sm font-medium">
        {field.label}
        {field.required && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}
      </legend>
      <div className="space-y-2">
        {options.map((option) => (
          <label key={option} className={cn("flex cursor-pointer items-center gap-2 text-sm", locked && "pointer-events-none opacity-70")}>
            <input
              type="checkbox"
              checked={selected.includes(option)}
              disabled={locked}
              onFocus={onInteract}
              onChange={(e) => onChange(e.target.checked ? [...selected, option] : selected.filter((s) => s !== option))}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
