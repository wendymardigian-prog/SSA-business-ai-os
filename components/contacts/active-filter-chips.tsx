"use client";

import { X } from "lucide-react";
import { filterChipText } from "@/lib/contacts/filters/catalog";
import { CUSTOM_FILTER_OP_LABELS, type CustomFilter } from "@/lib/contacts/list-filters";
import type { ContactFilterDef } from "@/lib/contacts/filters/types";
import type { ContactListFilters } from "@/lib/contacts/list-query";
import { displayCustomValue } from "@/lib/custom-fields";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";

/**
 * Los filtros puestos, debajo de la barra: con tantos filtros, hace falta ver
 * qué está aplicado sin abrir el panel. Cada chip tiene su "x" y, con dos o
 * más, "Limpiar todo". El texto sale del catálogo (`filterChipText`).
 */
export function ActiveFilterChips({
  defs,
  filters,
  options,
  onRemove,
  onRemoveCustom,
  onClear,
}: {
  defs: readonly ContactFilterDef[];
  filters: ContactListFilters;
  options: Readonly<Record<string, readonly MultiFilterOption[]>>;
  onRemove: (param: string) => void;
  onRemoveCustom: () => void;
  onClear: () => void;
}) {
  const chips = defs
    .filter((d) => (filters.values[d.param]?.length ?? 0) > 0)
    .map((d) => ({ key: d.param, text: filterChipText(d, filters.values[d.param] ?? [], options), remove: () => onRemove(d.param) }));
  if (filters.custom) chips.push({ key: "campo", text: customChipText(filters.custom), remove: onRemoveCustom });
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2 md:px-8" aria-label="Filtros aplicados">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary-edge bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs">
          <span className="min-w-0 truncate">{chip.text}</span>
          <button
            type="button"
            onClick={chip.remove}
            aria-label={`Quitar el filtro ${chip.text}`}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={onClear} className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Limpiar todo
        </button>
      )}
    </div>
  );
}

function customChipText(c: CustomFilter): string {
  const op = CUSTOM_FILTER_OP_LABELS[c.op];
  if (c.op === "empty" || c.op === "filled") return `${c.field.name} ${op}`;
  return `${c.field.name} ${op} ${displayCustomValue(c.field.type, c.value) || c.value}`;
}
