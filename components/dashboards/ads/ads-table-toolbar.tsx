"use client";

import { useState } from "react";
import { CircleDot, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterMenu, MenuGroupLabel, MenuOption } from "@/components/ui/filter-menu";
import { MultiFilterField } from "@/components/ui/multi-filter-field";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";
import type { CrmLevel, StatusFilter } from "@/lib/dashboards/ads-crm";
import { clearFilters, countMenuFilters, parseAmount, type AdsTableFilters, type FilterChip } from "@/lib/dashboards/ads-table-filters";
import { STATUS_FILTERS } from "./crm-table";
import { TAB_LABEL } from "./hierarchy-tables";

/**
 * Los controles de la pantalla Anuncios que van en la barra superior: las pestañas, el estado y el boton «Filtros», y abajo los
 * chips de lo que esta puesto. Las reglas viven en `lib/dashboards/ads-table-filters.ts`; esto solo las dibuja.
 */

const LEVELS: CrmLevel[] = ["campaign", "adset", "ad"];

/** Campañas / AdSets / Anuncios, como el selector de vista de Contactos. */
export function LevelTabs({ level, onChange }: { level: CrmLevel; onChange: (next: CrmLevel) => void }) {
  return (
    <nav aria-label="Nivel" className="flex shrink-0 rounded-lg bg-muted/60 p-0.5">
      {LEVELS.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={level === value}
          onClick={() => level !== value && onChange(value)}
          className={cn(
            "inline-flex h-8 items-center rounded-md px-2.5 text-sm whitespace-nowrap",
            level === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {TAB_LABEL[value]}
        </button>
      ))}
    </nav>
  );
}

/** Todos · 6 / Activos · 5 / Pausados · 1, en un desplegable aparte de «Filtros»: es lo que mas se cambia. */
export function StatusMenu({ value, counts, onChange }: { value: StatusFilter; counts: Record<StatusFilter, number>; onChange: (next: StatusFilter) => void }) {
  const current = STATUS_FILTERS.find((f) => f.value === value) ?? STATUS_FILTERS[0];
  return (
    <FilterMenu
      label="Estado"
      value={`${current.label} · ${counts[value]}`}
      active={value !== "all"}
      icon={<CircleDot className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      align="left"
      menuClassName="topbar:w-[220px]"
    >
      {STATUS_FILTERS.map((option) => (
        <MenuOption key={option.value} checked={value === option.value} onSelect={() => onChange(option.value)} title={option.label} trailing={counts[option.value]} />
      ))}
    </FilterMenu>
  );
}

/** Una opcion que se prende y se apaga sin cerrar el menu. */
function ToggleOption({ checked, onToggle, title, description }: { checked: boolean; onToggle: () => void; title: string; description: string }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] leading-none",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {checked && "✓"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/** Gasto desde / hasta. Se aplica al salir del campo o con Enter (no en cada tecla: cada cambio es una entrada del «atras»). */
function SpendRange({ filters, currency, onChange }: { filters: AdsTableFilters; currency: string | null; onChange: (next: AdsTableFilters) => void }) {
  const [min, setMin] = useState(filters.spendMin === null ? "" : String(filters.spendMin));
  const [max, setMax] = useState(filters.spendMax === null ? "" : String(filters.spendMax));
  const apply = () => {
    const spendMin = parseAmount(min);
    const spendMax = parseAmount(max);
    if (spendMin !== filters.spendMin || spendMax !== filters.spendMax) onChange({ ...filters, spendMin, spendMax });
  };
  const input = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm tabular-nums focus:border-primary-edge focus:outline-none focus:ring-1 focus:ring-primary-edge";
  return (
    <div className="px-2.5 pb-1">
      <span className="mb-0.5 block text-xs text-muted-foreground">Gasto{currency ? ` (${currency})` : ""}</span>
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Gasto desde</span>
          <input inputMode="decimal" placeholder="Desde" value={min} onChange={(e) => setMin(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()} className={input} />
        </label>
        <span className="text-xs text-muted-foreground">a</span>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Gasto hasta</span>
          <input inputMode="decimal" placeholder="Hasta" value={max} onChange={(e) => setMax(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()} className={input} />
        </label>
      </div>
    </div>
  );
}

export function AdsFiltersMenu({
  filters,
  onChange,
  currency,
  campaignOptions,
  adsetOptions,
  objectiveOptions,
}: {
  filters: AdsTableFilters;
  onChange: (next: AdsTableFilters) => void;
  currency: string | null;
  campaignOptions: MultiFilterOption[];
  adsetOptions: MultiFilterOption[];
  objectiveOptions: MultiFilterOption[];
}) {
  const count = countMenuFilters(filters);
  return (
    <FilterMenu
      label="Filtros"
      compact
      badge={count}
      active={count > 0}
      icon={<SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      menuClassName="topbar:w-[320px]"
    >
      <div className="space-y-1 pb-1.5">
        <MenuGroupLabel>Mostrar solo</MenuGroupLabel>
        <ToggleOption
          checked={filters.withSpend}
          onToggle={() => onChange({ ...filters, withSpend: !filters.withSpend })}
          title="Con gasto"
          description="Lo que gastó algo en el período."
        />
        <ToggleOption
          checked={filters.withLeads}
          onToggle={() => onChange({ ...filters, withLeads: !filters.withLeads })}
          title="Con leads"
          description="Lo que trajo al menos una persona al CRM."
        />

        <MenuGroupLabel>Gasto</MenuGroupLabel>
        {/* La clave reinicia los campos cuando el filtro cambia desde afuera (un chip, «Limpiar»). */}
        <SpendRange key={`${filters.spendMin}|${filters.spendMax}`} filters={filters} currency={currency} onChange={onChange} />

        <MenuGroupLabel>Campaña y conjunto</MenuGroupLabel>
        <div className="space-y-2 px-2.5">
          <MultiFilterField label="Campaña" options={campaignOptions} selected={filters.campaignIds} onChange={(campaignIds) => onChange({ ...filters, campaignIds })} />
          <MultiFilterField label="AdSet" options={adsetOptions} selected={filters.adsetIds} onChange={(adsetIds) => onChange({ ...filters, adsetIds })} />
          {objectiveOptions.length > 0 && (
            <MultiFilterField label="Objetivo de la campaña" options={objectiveOptions} selected={filters.objectives} onChange={(objectives) => onChange({ ...filters, objectives })} />
          )}
        </div>

        {count > 0 && (
          <div className="px-2.5 pt-2">
            <button
              type="button"
              onClick={() => onChange({ ...clearFilters(filters), q: filters.q, status: filters.status })}
              className="h-8 w-full rounded-lg border border-border text-xs font-medium hover:bg-accent"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>
    </FilterMenu>
  );
}

/** Lo que esta puesto, arriba de la tabla: cada filtro con su X. */
export function FilterChips({ chips, onChange, onClearAll }: { chips: FilterChip[]; onChange: (next: AdsTableFilters) => void; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <>
      {chips.map((chip) => (
        <span key={chip.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            onClick={() => onChange(chip.clear)}
            aria-label={`Sacar el filtro ${chip.label}`}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={onClearAll} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Sacar todos
        </button>
      )}
    </>
  );
}
