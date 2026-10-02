"use client";

import Link from "next/link";
import { SlidersHorizontal, X, Loader2, FileText } from "lucide-react";
import { DATE_PRESETS, DATE_PRESET_LABELS } from "@/lib/dates";
import {
  INBOX_STATUS_VALUES,
  INBOX_STATUS_LABELS,
  ASSIGNMENT_UNASSIGNED,
  ASSIGNMENT_AI,
  countActiveFilters,
  type InboxFilters,
} from "@/lib/inbox/filters";
import { countMenuFilters, describeInboxFilters, type FilterSummaryCatalog } from "@/lib/inbox/filter-summary";
import { NEEDS_HUMAN_PARAM } from "@/lib/inbox/needs-human";
import { cn } from "@/lib/utils";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import { useInboxUrl } from "@/components/inbox/use-inbox-url";
import { useDraftCounts, visibleDraftCount } from "@/components/drafts/use-draft-counts";
import { draftsQueueHref } from "@/lib/agent/drafts/destination";
import type { PendingDraftCounts } from "@/lib/actions/agent-drafts";

/**
 * Los filtros de la Bandeja (F16), repartidos en el Bloque I:
 *
 * - `InboxFiltersMenu`: el boton de la barra superior y su popover (I3). Canal,
 *   tags, agente, asignacion y fecha. Flota: no empuja la lista.
 * - `InboxFilterSummary`: la linea de abajo de la barra, con lo que esta
 *   filtrado en palabras y una `×` para limpiar. Sin filtros no se dibuja.
 * - `InboxStatusBar`: las pastillas de estado y el link a borradores, arriba de
 *   la lista (I6). Es el filtro que mas se usa y no se esconde detras de un clic.
 *
 * El buscador es `SectionSearch` (`components/comunicacion/section-search.tsx`),
 * compartido con las otras tres secciones. Todos cambian la URL con
 * `useInboxUrl`: el estado vive ahi y no en los componentes.
 */

export function InboxFiltersMenu({
  filters,
  tags,
  platforms,
  members,
}: {
  filters: InboxFilters;
  tags: { id: string; name: string; color: string | null }[];
  platforms: { value: string; label: string }[];
  members: { userId: string; label: string }[];
}) {
  const { pending, setParam, toggle, clearAll } = useInboxUrl();
  const menuCount = countMenuFilters(filters);

  return (
    <FilterMenu
      label="Filtros"
      active={menuCount > 0}
      icon={
        pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        )
      }
      value={
        <>
          {/* El "Filtros:" del boton se esconde en el telefono; el lector de
              pantalla lo sigue leyendo. */}
          <span className="sr-only md:hidden">Filtros: </span>
          {menuCount > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {menuCount}
            </span>
          ) : (
            <span className="font-normal text-muted-foreground">ninguno</span>
          )}
        </>
      }
      menuClassName="topbar:w-[340px]"
    >
      <div className="space-y-1 pb-1.5">
        <FilterGroup label="Canal">
          {platforms.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">No hay canales conectados.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {platforms.map((p) => (
                <Chip
                  key={p.value}
                  active={filters.platforms.includes(p.value)}
                  onClick={() => toggle("canal", p.value)}
                >
                  {p.label}
                </Chip>
              ))}
            </div>
          )}
        </FilterGroup>

        <FilterGroup label="Tags">
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">Todavía no hay tags.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Chip
                  key={tag.id}
                  active={filters.tagIds.includes(tag.id)}
                  onClick={() => toggle("tag", tag.id)}
                >
                  {tag.name}
                </Chip>
              ))}
            </div>
          )}
        </FilterGroup>

        <FilterGroup label="Agente de IA">
          <div className="flex flex-wrap gap-1.5">
            <Chip
              active={filters.agentError}
              onClick={() => setParam("error-agente", filters.agentError ? "" : "1")}
            >
              Con error del agente
            </Chip>
            {/* F11: distinto del de arriba. Ahi el agente falló; acá decidió no
                responder porque no pudo entender lo que llegó, y hay un lead
                esperando a una persona. */}
            <Chip
              active={filters.needsHuman}
              onClick={() => setParam(NEEDS_HUMAN_PARAM, filters.needsHuman ? "" : "1")}
            >
              Necesita humano
            </Chip>
          </div>
        </FilterGroup>

        <FilterGroup label="Asignación">
          <select
            value={filters.assignment}
            onChange={(e) => setParam("asignado", e.target.value)}
            aria-label="Filtrar por asignación"
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Todas</option>
            <option value={ASSIGNMENT_UNASSIGNED}>Sin asignar</option>
            <option value={ASSIGNMENT_AI}>Agente IA</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </select>
        </FilterGroup>

        <FilterGroup label="Último mensaje">
          <select
            value={filters.datePreset}
            onChange={(e) => setParam("fecha", e.target.value)}
            aria-label="Filtrar por fecha del último mensaje"
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Cualquier fecha</option>
            {DATE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {DATE_PRESET_LABELS[preset]}
              </option>
            ))}
          </select>

          {filters.datePreset === "custom" && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setParam("desde", e.target.value)}
                aria-label="Desde"
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">a</span>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setParam("hasta", e.target.value)}
                aria-label="Hasta"
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
        </FilterGroup>

        {menuCount > 0 && (
          <div className="mx-2.5 mt-2 flex items-center justify-between border-t border-border pt-2">
            <span className="text-xs text-muted-foreground">
              {menuCount === 1 ? "1 filtro activo" : `${menuCount} filtros activos`}
            </span>
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

/**
 * Lo filtrado, en una linea, debajo de la barra (I3). Cuenta con la funcion de
 * siempre (`countActiveFilters`), asi que tambien aparece con solo una busqueda
 * o un estado distinto de "Abiertas": la linea dice todo lo que recorta la lista.
 */
export function InboxFilterSummary({
  filters,
  catalog,
}: {
  filters: InboxFilters;
  catalog: FilterSummaryCatalog;
}) {
  const { clearAll } = useInboxUrl();
  if (countActiveFilters(filters) === 0) return null;

  const text = describeInboxFilters(filters, catalog).join(" · ");
  return (
    <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 md:px-6">
      <span className="text-xs font-medium text-muted-foreground">Filtrando:</span>
      <span className="min-w-0 flex-1 truncate text-xs" title={text}>
        {text}
      </span>
      <button
        type="button"
        onClick={clearAll}
        aria-label="Limpiar filtros"
        title="Limpiar filtros"
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** Las pastillas de estado y el link a borradores, arriba de la lista (I6). */
export function InboxStatusBar({
  filters,
  workspaceId,
  draftCounts,
}: {
  filters: InboxFilters;
  workspaceId: string;
  /** Valor inicial de la pestana "Borradores (N)"; Realtime la mantiene al dia. */
  draftCounts?: PendingDraftCounts;
}) {
  const { setParam } = useInboxUrl();
  const drafts = useDraftCounts(workspaceId, draftCounts, "inbox-drafts");
  const waitingDrafts = visibleDraftCount(drafts);

  return (
    <div className="flex flex-wrap gap-1 border-b border-border px-4 py-3">
      {INBOX_STATUS_VALUES.map((value) => (
        <button
          key={value}
          onClick={() => setParam("estado", value)}
          aria-pressed={filters.status === value}
          className={cn(
            "min-h-9 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors md:min-h-0",
            filters.status === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {INBOX_STATUS_LABELS[value]}
        </button>
      ))}
      {/* Bloque 2d: la cola de borradores vive aca y no en el menu. Un
          borrador es una conversacion esperando respuesta, no otra seccion
          del sistema. Con cero no aparece. */}
      {waitingDrafts > 0 && (
        <Link
          href={draftsQueueHref(drafts)}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-dashed border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-950/30 md:min-h-0"
        >
          <FileText className="h-3 w-3" aria-hidden />
          Borradores ({waitingDrafts})
        </Link>
      )}
    </div>
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

/**
 * Un chip que se prende y se apaga. `menuitemcheckbox` porque vive adentro de un
 * `role="menu"`; no cierra el menu al tocarlo (se marcan varios de una vez).
 */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      onClick={onClick}
      aria-checked={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary/10 font-medium text-primary"
          : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
