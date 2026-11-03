"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MULTI_FILTER_SEARCH_FROM, filterOptions, multiFilterSummary, type MultiFilterOption } from "@/lib/ui/multi-filter";

/**
 * Un filtro de varias opciones adentro de un menú de filtros (`FilterMenu`).
 *
 * Cerrado ocupa lo mismo que un `<select>`: el nombre arriba y lo elegido
 * ("Todos", el nombre, o "3 elegidos"). Al abrirlo muestra las opciones como
 * casillas que se prenden y se apagan sin cerrar el menú, así se marcan varias
 * de una pasada. Con muchas opciones (etiquetas, personas, productos) suma un
 * buscador arriba.
 *
 * Cada opción es un `<button role="menuitemcheckbox">`: el menú las recorre
 * con las flechas igual que al resto (`lib/ui/menu-keys.ts`).
 */

export function MultiFilterField({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly MultiFilterOption[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  if (options.length === 0 && selected.length === 0) return null;

  const byValue = new Map(options.map((o) => [o.value, o]));
  // Un valor elegido que ya no está entre las opciones (un estado archivado, una
  // persona que se fue) se sigue viendo para poder quitarlo.
  const labelOf = (value: string) => byValue.get(value)?.label ?? value;
  const missing: MultiFilterOption[] = selected.filter((v) => !byValue.has(v)).map((v) => ({ value: v, label: v }));
  const visible = filterOptions([...options, ...missing], query);
  const taken = new Set(selected);

  function toggle(value: string) {
    onChange(taken.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div>
      <span className="mb-0.5 block text-xs text-muted-foreground">{label}</span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-ring",
          selected.length > 0 ? "border-primary-edge text-foreground" : "border-input text-muted-foreground",
        )}
      >
        <span className="min-w-0 truncate">{multiFilterSummary(selected, labelOf)}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div id={listId} className="mt-1 space-y-1.5 rounded-lg border border-border bg-background p-1.5">
          {options.length >= MULTI_FILTER_SEARCH_FROM && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar en ${label.toLowerCase()}…`}
              aria-label={`Buscar en ${label.toLowerCase()}`}
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <div role="group" aria-label={label} className="max-h-52 space-y-0.5 overflow-auto">
            {visible.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Nada coincide con «{query}».</p>
            ) : (
              visible.map((o) => {
                const checked = taken.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded border",
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    {o.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.color }} aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden />
              Quitar {selected.length === 1 ? "la elegida" : `las ${selected.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
