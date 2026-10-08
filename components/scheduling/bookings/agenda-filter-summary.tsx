"use client";

import { X } from "lucide-react";
import { useAgendaUrl } from "./use-agenda-url";
import { agendaFilterChips, type AgendaFilterCatalog, type AgendaFilters } from "@/lib/scheduling/agenda-filters";

/**
 * La línea "Filtrando: …" debajo de la barra superior (F33, Agenda v2).
 *
 * A diferencia de la Bandeja (una sola `×` limpia todo), cada chip tiene la
 * suya: Wendy pidió que no sea fácil perder de vista una agenda por quedarse
 * con un filtro puesto sin darse cuenta, y un chip que se saca de a uno hace
 * visible exactamente qué está filtrando.
 */
export function AgendaFilterSummary({ filters, catalog }: { filters: AgendaFilters; catalog: AgendaFilterCatalog }) {
  const { toggle, clearAll } = useAgendaUrl();
  const chips = agendaFilterChips(filters, catalog);
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/30 px-4 py-2 md:px-6">
      <span className="text-xs font-medium text-muted-foreground">Filtrando:</span>
      {chips.map((chip) => (
        <button
          key={`${chip.param}-${chip.value}`}
          type="button"
          onClick={() => toggle(chip.param, chip.value)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs hover:bg-accent"
          title={`Sacar el filtro "${chip.label}"`}
        >
          {chip.label}
          <X className="h-3 w-3 text-muted-foreground" aria-hidden />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={clearAll} className="ml-1 text-xs text-muted-foreground underline hover:text-foreground">
          Limpiar todo
        </button>
      )}
    </div>
  );
}
