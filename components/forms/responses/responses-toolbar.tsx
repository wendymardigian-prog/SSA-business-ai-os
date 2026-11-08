"use client";

import { Layers, SlidersHorizontal, X } from "lucide-react";
import { DashboardPeriodControl } from "@/components/dashboards/dashboard-period-control";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { FilterMenu, MenuGroupLabel, MenuOption } from "@/components/ui/filter-menu";
import { MultiFilterField } from "@/components/ui/multi-filter-field";
import type { PeriodFilter, PeriodSelection } from "@/lib/dashboards/period-filter";
import { applyPeriodToParams } from "@/lib/dashboards/period-filter";
import {
  clearMenuFilters,
  countMenuFilters,
  dimensionParam,
  filterChips,
  type ResponseViewFilters,
} from "@/lib/forms/response-filters-view";
import { DIMENSION_LABELS, type ResponseDimension } from "@/lib/forms/response-index";
import { DIMENSION_PARAM, RESPONSES_DEFAULT_PERIOD } from "@/lib/forms/responses";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";

export interface ToolbarFilters extends ResponseViewFilters {
  period: PeriodFilter;
  /** Un link viejo trae `desde`/`hasta`: filtran mientras el botón de fecha siga en el Histórico. */
  legacyRange: boolean;
  q: string;
  groupBy: ResponseDimension | null;
}

/** Lo que la barra le pide a la URL. Lo aplica `useUrlFilters` (vuelve a la página 1). */
type ApplyParams = (updates: Record<string, string | null>) => void;

const SELECT_CLASS =
  "w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * La izquierda de la barra de Respuestas: buscar, la fecha, «Filtros» y «Agrupar por». Columnas y
 * Exportar van a la derecha en la misma fila (los pone la tabla).
 */
export function ResponsesToolbarFilters({
  filters,
  dimensions,
  facets,
  search,
  pending,
  onParams,
}: {
  filters: ToolbarFilters;
  dimensions: readonly ResponseDimension[];
  facets: Record<ResponseDimension, MultiFilterOption[]>;
  /** La URL actual, para escribir el período sin pisar el resto. */
  search: string;
  pending: boolean;
  onParams: ApplyParams;
}) {
  const count = countMenuFilters(filters, dimensions);

  function applyPeriod(selection: PeriodSelection) {
    const next = applyPeriodToParams(new URLSearchParams(search), selection, RESPONSES_DEFAULT_PERIOD);
    // Los días de un link viejo dejan de valer: ahora manda el botón.
    onParams({ range: next.get("range"), from: next.get("from"), to: next.get("to"), periodo: null, desde: null, hasta: null });
  }

  return (
    <>
      <ExpandableSearch
        value={filters.q}
        onCommit={(q) => onParams({ q: q || null })}
        label="Buscar en las respuestas"
        placeholder="Nombre, email, teléfono, campaña…"
        hint="Busca en todas las respuestas y en la campaña de la visita"
        pending={pending}
      />
      <DashboardPeriodControl period={filters.period} defaultPreset={RESPONSES_DEFAULT_PERIOD} onApply={applyPeriod} />

      <FilterMenu
        label="Filtros"
        compact
        badge={count}
        active={count > 0}
        align="left"
        icon={<SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
        menuClassName="topbar:w-[320px]"
      >
        <div className="space-y-1 pb-1.5">
          <MenuGroupLabel>Respuesta</MenuGroupLabel>
          <div className="grid grid-cols-2 gap-2 px-2.5">
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted-foreground">Estado</span>
              <select
                value={filters.status === "all" ? "" : filters.status}
                onChange={(e) => onParams({ estado: e.target.value || null })}
                className={`${SELECT_CLASS} ${filters.status !== "all" ? "border-primary-edge" : "border-input"}`}
              >
                <option value="">Todos</option>
                <option value="received">Recibida</option>
                <option value="no_contact">Sin contacto</option>
                <option value="spam">Spam</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs text-muted-foreground">Contacto</span>
              <select
                value={filters.contact === "with" ? "con" : filters.contact === "without" ? "sin" : ""}
                onChange={(e) => onParams({ contacto: e.target.value || null })}
                className={`${SELECT_CLASS} ${filters.contact !== "all" ? "border-primary-edge" : "border-input"}`}
              >
                <option value="">Todos</option>
                <option value="con">Con contacto</option>
                <option value="sin">Sin contacto</option>
              </select>
            </label>
          </div>

          <MenuGroupLabel>Origen</MenuGroupLabel>
          <div className="space-y-2 px-2.5">
            {dimensions.map((d) => (
              <MultiFilterField
                key={d}
                label={d === "pais" ? "País (del teléfono)" : DIMENSION_LABELS[d]}
                options={facets[d]}
                selected={filters.dims[d] ?? []}
                onChange={(values) => onParams({ [DIMENSION_PARAM[d]]: dimensionParam(values) })}
              />
            ))}
          </div>

          {count > 0 && (
            <div className="px-2.5 pt-2">
              <button
                type="button"
                onClick={() => onParams(clearMenuFilters(dimensions))}
                className="h-8 w-full rounded-lg border border-border text-xs font-medium hover:bg-accent"
              >
                Limpiar filtros
              </button>
            </div>
          )}
        </div>
      </FilterMenu>

      <FilterMenu
        label="Agrupar por"
        value={filters.groupBy ? DIMENSION_LABELS[filters.groupBy] : "Nada"}
        active={filters.groupBy !== null}
        align="left"
        icon={<Layers className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
        menuClassName="topbar:w-[240px]"
      >
        <MenuGroupLabel>Ver cuántas hay de cada</MenuGroupLabel>
        <MenuOption checked={filters.groupBy === null} onSelect={() => onParams({ agrupar: null })} title="Sin agrupar" description="La lista de respuestas" />
        {dimensions.map((d) => (
          <MenuOption key={d} checked={filters.groupBy === d} onSelect={() => onParams({ agrupar: d })} title={DIMENSION_LABELS[d]} />
        ))}
      </FilterMenu>
    </>
  );
}

/** Los filtros puestos, de a uno, debajo de la barra. */
export function ResponsesFilterChips({
  filters,
  dimensions,
  onParams,
}: {
  filters: ToolbarFilters;
  dimensions: readonly ResponseDimension[];
  onParams: ApplyParams;
}) {
  const chips = filterChips(filters, dimensions);
  if (filters.legacyRange && filters.period.period === RESPONSES_DEFAULT_PERIOD && !filters.period.from) {
    chips.unshift({ key: "fechas", label: "Fechas de un link anterior", clear: { desde: null, hasta: null } });
  }
  if (chips.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            onClick={() => onParams(chip.clear)}
            aria-label={`Sacar el filtro ${chip.label}`}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={() => onParams(clearMenuFilters(dimensions))} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Sacar todos
        </button>
      )}
    </div>
  );
}
