"use client";

import { SlidersHorizontal, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import { useAgendaUrl } from "./use-agenda-url";
import {
  ORIGIN_LABELS,
  ORIGIN_VALUES,
  countActiveAgendaFilters,
  statusGroupsForFilter,
  type AgendaFilters,
} from "@/lib/scheduling/agenda-filters";
import { categoryTree, type CategoryRow } from "@/lib/scheduling/categories";
import { statusLabel } from "@/lib/scheduling/booking-status";

/**
 * El widget de filtros de Agenda (F33, Agenda v2), calcado de
 * `InboxFiltersMenu`: un botón con contador y un popover de grupos de chips
 * multi-selección. Cada chip prende o apaga un valor (`toggle`); no cierra el
 * menú, así se marcan varios de una pasada.
 */
export function AgendaFiltersMenu({
  filters,
  categories,
  events,
  hosts,
  utmOptions,
}: {
  filters: AgendaFilters;
  categories: CategoryRow[];
  events: Array<{ id: string; title: string }>;
  /** Solo con alcance total: sin esto, filtrar por anfitrión no tiene sentido (es uno solo). */
  hosts: Array<{ userId: string; label: string }> | null;
  utmOptions: { sources: string[]; mediums: string[]; campaigns: string[] };
}) {
  const { pending, toggle, clearAll } = useAgendaUrl();
  const count = countActiveAgendaFilters(filters);

  return (
    <FilterMenu
      label="Filtros"
      active={count > 0}
      icon={
        pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        )
      }
      value={
        count > 0 ? (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {count}
          </span>
        ) : (
          <span className="font-normal text-muted-foreground">ninguno</span>
        )
      }
      menuClassName="topbar:w-[340px]"
    >
      <div className="space-y-1 pb-1.5">
        <FilterGroup label="Estado">
          <div className="space-y-2">
            {statusGroupsForFilter().map((g) => (
              <div key={g.group}>
                <p className="mb-1 text-[11px] text-muted-foreground/70">{g.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.statuses.map((s) => (
                    <Chip key={s} active={filters.statuses.includes(s)} onClick={() => toggle("estado", s)}>
                      {statusLabel(s)}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </FilterGroup>

        <FilterGroup label="Área y tipo">
          {categories.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">Todavía no hay áreas.</p>
          ) : (
            <div className="space-y-2">
              {categoryTree(categories).map(({ area, types }) => (
                <div key={area.id}>
                  <Chip active={filters.categoryIds.includes(area.id)} onClick={() => toggle("categoria", area.id)}>
                    {area.name} (todo)
                  </Chip>{" "}
                  {types.map((t) => (
                    <Chip key={t.id} active={filters.categoryIds.includes(t.id)} onClick={() => toggle("categoria", t.id)}>
                      {t.name}
                    </Chip>
                  ))}
                </div>
              ))}
            </div>
          )}
        </FilterGroup>

        {events.length > 0 && (
          <FilterGroup label="Evento">
            <div className="flex flex-wrap gap-1.5">
              {events.map((e) => (
                <Chip key={e.id} active={filters.eventTypeIds.includes(e.id)} onClick={() => toggle("evento", e.id)}>
                  {e.title}
                </Chip>
              ))}
            </div>
          </FilterGroup>
        )}

        {hosts && hosts.length > 0 && (
          <FilterGroup label="Anfitrión / closer">
            <div className="flex flex-wrap gap-1.5">
              {hosts.map((h) => (
                <Chip key={h.userId} active={filters.hostUserIds.includes(h.userId)} onClick={() => toggle("anfitrion", h.userId)}>
                  {h.label}
                </Chip>
              ))}
            </div>
          </FilterGroup>
        )}

        <FilterGroup label="Origen">
          <div className="flex flex-wrap gap-1.5">
            {ORIGIN_VALUES.map((o) => (
              <Chip key={o} active={filters.origins.includes(o)} onClick={() => toggle("origen", o)}>
                {ORIGIN_LABELS[o]}
              </Chip>
            ))}
          </div>
        </FilterGroup>

        {(utmOptions.sources.length > 0 || utmOptions.mediums.length > 0 || utmOptions.campaigns.length > 0) && (
          <FilterGroup label="UTM">
            <div className="space-y-2">
              {utmOptions.sources.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] text-muted-foreground/70">Fuente</p>
                  <div className="flex flex-wrap gap-1.5">
                    {utmOptions.sources.map((v) => (
                      <Chip key={v} active={filters.utmSources.includes(v)} onClick={() => toggle("utm_source", v)}>
                        {v}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
              {utmOptions.mediums.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] text-muted-foreground/70">Medio</p>
                  <div className="flex flex-wrap gap-1.5">
                    {utmOptions.mediums.map((v) => (
                      <Chip key={v} active={filters.utmMediums.includes(v)} onClick={() => toggle("utm_medium", v)}>
                        {v}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
              {utmOptions.campaigns.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] text-muted-foreground/70">Campaña</p>
                  <div className="flex flex-wrap gap-1.5">
                    {utmOptions.campaigns.map((v) => (
                      <Chip key={v} active={filters.utmCampaigns.includes(v)} onClick={() => toggle("utm_campaign", v)}>
                        {v}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </FilterGroup>
        )}

        {count > 0 && (
          <div className="mx-2.5 mt-2 flex items-center justify-between border-t border-border pt-2">
            <span className="text-xs text-muted-foreground">{count === 1 ? "1 filtro activo" : `${count} filtros activos`}</span>
            <button
              type="button"
              onClick={clearAll}
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

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <MenuGroupLabel>{label}</MenuGroupLabel>
      <div className="px-2.5">{children}</div>
    </div>
  );
}

/** Un chip que se prende y se apaga, igual al de la Bandeja (`role="menuitemcheckbox"`: no cierra el menú). */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      onClick={onClick}
      aria-checked={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
