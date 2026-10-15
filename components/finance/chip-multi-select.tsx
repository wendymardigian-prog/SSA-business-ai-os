"use client";

import { X } from "lucide-react";

/**
 * Un filtro de varias opciones sin menús flotantes: un `<select>` que SUMA la opción elegida y, al lado, las
 * elegidas como chips que se quitan con un clic. Se maneja entero con el teclado y funciona igual en el celular.
 */
export interface ChipOption {
  value: string;
  label: string;
}

export interface ChipOptionGroup {
  label: string;
  options: ChipOption[];
}

export function ChipMultiSelect({
  label,
  groups,
  selected,
  labelOf,
  onChange,
}: {
  /** El nombre del filtro («Categoría»): es la etiqueta del select. */
  label: string;
  groups: ChipOptionGroup[];
  selected: readonly string[];
  /** Cómo se llama una opción elegida (puede no estar en `groups`, por ejemplo una categoría archivada). */
  labelOf: (value: string) => string;
  onChange: (values: string[]) => void;
}) {
  const taken = new Set(selected);
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      <select
        aria-label={label}
        value=""
        onChange={(e) => {
          if (e.target.value) onChange([...selected, e.target.value]);
        }}
        className={`h-9 max-w-full rounded-lg border bg-background px-2 text-sm ${selected.length > 0 ? "border-primary text-primary" : "border-border"}`}
      >
        <option value="">{selected.length > 0 ? `${label} (${selected.length})` : label}</option>
        {groups.map((g) => {
          const options = g.options.filter((o) => !taken.has(o.value));
          if (options.length === 0) return null;
          return g.label ? (
            <optgroup key={g.label} label={g.label}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ) : (
            options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
          );
        })}
      </select>
      {selected.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(selected.filter((v) => v !== value))}
          aria-label={`Quitar ${label.toLowerCase()}: ${labelOf(value)}`}
          className="inline-flex h-7 max-w-[11rem] items-center gap-1 rounded-full border border-border bg-muted px-2 text-xs hover:bg-accent"
        >
          <span className="truncate">{labelOf(value)}</span>
          <X className="h-3 w-3 shrink-0" aria-hidden />
        </button>
      ))}
    </div>
  );
}
