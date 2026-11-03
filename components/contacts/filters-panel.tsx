"use client";

import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import { MultiFilterField } from "@/components/ui/multi-filter-field";
import { CustomFieldFilter } from "@/components/contacts/list-pipeline-controls";
import { GROUPS, filterMatches, filterOptionList, filterPanelGroups } from "@/lib/contacts/filters/catalog";
import { DATE_PRESET_LABELS, formatDateRange, parseDateValue } from "@/lib/contacts/filters/dates";
import type { ContactFilterDef } from "@/lib/contacts/filters/types";
import type { ContactListFilters } from "@/lib/contacts/list-query";
import type { CustomFieldRef, CustomFilterOp } from "@/lib/contacts/list-filters";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";

/**
 * El panel de filtros de la lista de contactos. Un buscador arriba (son
 * muchos) que filtra por el nombre del filtro y su grupo, y cada filtro con el
 * control de su tipo. Qué filtros hay y qué hace cada uno lo dice el catálogo
 * (`lib/contacts/filters/catalog.ts`): esto solo lo compone.
 *
 * Nada filtra en el navegador: cada cambio escribe la URL y la página vuelve a
 * consultar.
 */

const CUSTOM_FILTER_ENTRY = { label: "Campo personalizado", group: GROUPS.custom, keywords: "campos" };

export function ContactFiltersPanel({
  defs,
  filters,
  options,
  customFields,
  customFilter,
  hidden,
  activeCount,
  onList,
  onParams,
  onClear,
}: {
  defs: readonly ContactFilterDef[];
  filters: ContactListFilters;
  options: Readonly<Record<string, readonly MultiFilterOption[]>>;
  customFields: CustomFieldRef[];
  customFilter: { slug: string; op: CustomFilterOp; value: string } | null;
  /** Filtros que no tienen sentido hoy (no hay contactos sin datos, por ejemplo). Si están puestos se muestran igual. */
  hidden?: ReadonlySet<string>;
  activeCount: number;
  onList: (param: string, values: readonly string[]) => void;
  onParams: (patch: Record<string, string>) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const usable = defs.filter((d) => !hidden?.has(d.param) || (filters.values[d.param]?.length ?? 0) > 0);
  const groups = filterPanelGroups(usable, query);
  const showCustom = customFields.length > 0 && filterMatches(CUSTOM_FILTER_ENTRY, query);
  const customGroupIndex = groups.findIndex((g) => g.group.order > GROUPS.custom.order);

  const customBlock = showCustom && (
    <div key="custom-field">
      <MenuGroupLabel>{GROUPS.custom.label}</MenuGroupLabel>
      <CustomFieldFilter
        key={customFilter ? `${customFilter.slug}:${customFilter.op}:${customFilter.value}` : "none"}
        fields={customFields}
        current={customFilter}
        onApply={(next) => onParams(next)}
      />
    </div>
  );

  return (
    <FilterMenu
      label="Filtros"
      compact
      badge={activeCount}
      active={activeCount > 0}
      icon={<SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      menuClassName="topbar:w-[360px]"
    >
      <div className="space-y-2 px-2.5 pb-2">
        <label className="relative block pt-1">
          <span className="sr-only">Buscar un filtro</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 mt-0.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar un filtro…"
            className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        {groups.length === 0 && !showCustom && (
          <p role="status" className="py-4 text-center text-xs text-muted-foreground">
            Ningún filtro coincide con «{query}».
          </p>
        )}

        {groups.map(({ group, filters: list }, i) => (
          <div key={group.key} className="space-y-2">
            {i === customGroupIndex && customBlock}
            <MenuGroupLabel>{group.label}</MenuGroupLabel>
            {list.map((def) => (
              <FilterControl
                key={def.param}
                def={def}
                values={filters.values[def.param] ?? []}
                options={filterOptionList(def, options)}
                onList={(v) => onList(def.param, v)}
              />
            ))}
          </div>
        ))}
        {customGroupIndex < 0 && customBlock}

        {activeCount > 0 && (
          <div className="flex items-center justify-between border-t border-border pt-2">
            <span className="text-xs text-muted-foreground">{activeCount === 1 ? "1 filtro activo" : `${activeCount} filtros activos`}</span>
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden />
              Limpiar filtros
            </button>
          </div>
        )}
      </div>
    </FilterMenu>
  );
}

function FilterControl({
  def,
  values,
  options,
  onList,
}: {
  def: ContactFilterDef;
  values: readonly string[];
  options: MultiFilterOption[];
  onList: (values: readonly string[]) => void;
}) {
  switch (def.kind) {
    case "multi":
      return <MultiFilterField label={def.label} options={options} selected={values} onChange={onList} />;
    case "yesno":
      return <YesNoField label={def.label} hint={def.hint} value={values[0] ?? ""} onChange={(v) => onList(v ? [v] : [])} />;
    case "choice":
      return (
        <label className="block">
          <span className="mb-0.5 block text-xs text-muted-foreground">{def.label}</span>
          <select
            value={values[0] ?? ""}
            onChange={(e) => onList(e.target.value ? [e.target.value] : [])}
            className={cn(
              "w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
              values.length > 0 ? "border-primary-edge" : "border-input",
            )}
          >
            <option value="">{def.defaultLabel ?? "Todos"}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {def.hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{def.hint}</span>}
        </label>
      );
    case "date":
      return <DateField key={values[0] ?? ""} def={def} value={values[0] ?? ""} onChange={(v) => onList(v ? [v] : [])} />;
  }
}

/** Todos / Sí / No, en una fila. Cada botón es una opción del menú (se recorre con las flechas). */
function YesNoField({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  const choices = [
    ["", "Todos"],
    ["si", "Sí"],
    ["no", "No"],
  ] as const;
  return (
    <div>
      <span className="mb-0.5 block text-xs text-muted-foreground">{label}</span>
      <div role="group" aria-label={label} className={cn("flex rounded-lg border p-0.5", value ? "border-primary-edge" : "border-input")}>
        {choices.map(([v, text]) => (
          <button
            key={v || "todos"}
            type="button"
            role="menuitemradio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "h-7 flex-1 rounded-md text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === v ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {text}
          </button>
        ))}
      </div>
      {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** Un atajo ("Últimos 7 días") o un rango entre dos días, que se aplica con el botón. */
function DateField({ def, value, onChange }: { def: ContactFilterDef; value: string; onChange: (v: string) => void }) {
  const presets = def.datePresets ?? [];
  const parsed = value ? parseDateValue(value, presets) : null;
  const isRange = parsed !== null && !("preset" in parsed);
  const [mode, setMode] = useState<string>(isRange ? "rango" : parsed && "preset" in parsed ? parsed.preset : "");
  const [from, setFrom] = useState(isRange ? (parsed.from ?? "") : "");
  const [to, setTo] = useState(isRange ? (parsed.to ?? "") : "");
  const inputClass = "w-full rounded-lg border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-1.5">
      <label className="block">
        <span className="mb-0.5 block text-xs text-muted-foreground">{def.label}</span>
        <select
          value={mode}
          onChange={(e) => {
            const next = e.target.value;
            setMode(next);
            if (next !== "rango") onChange(next);
          }}
          className={cn(
            "w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
            value ? "border-primary-edge" : "border-input",
          )}
        >
          <option value="">Cualquier fecha</option>
          {presets.map((p) => (
            <option key={p} value={p}>
              {DATE_PRESET_LABELS[p]}
            </option>
          ))}
          {def.dateRange && <option value="rango">Entre fechas…</option>}
        </select>
      </label>
      {mode === "rango" && (
        <div className="flex items-end gap-1.5">
          <label className="block min-w-0 flex-1">
            <span className="mb-0.5 block text-[11px] text-muted-foreground">Desde</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="block min-w-0 flex-1">
            <span className="mb-0.5 block text-[11px] text-muted-foreground">Hasta</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </label>
          <button
            type="button"
            disabled={!from && !to}
            onClick={() => onChange(formatDateRange(from, to))}
            className="h-[30px] shrink-0 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}
