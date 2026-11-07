"use client";

import Link from "next/link";
import { SlidersHorizontal, X, Loader2, FileText } from "lucide-react";
import { DATE_PRESETS, DATE_PRESET_LABELS } from "@/lib/dates";
import {
  INBOX_LIST_TYPES,
  INBOX_LIST_TYPE_LABELS,
  INBOX_STATUS_VALUES,
  INBOX_STATUS_LABELS,
  DEFAULT_INBOX_STATUS,
  LEGACY_VIEW_PARAM,
  LIST_TYPE_PARAM,
  ASSIGNMENT_UNASSIGNED,
  ASSIGNMENT_AI,
  ASSIGNMENT_MINE,
  HIDE_KNOWN_PARAM,
  HIDE_KNOWN_VALUE,
  HIDE_CUSTOMERS_PARAM,
  UNIDENTIFIED_PARAM,
  countActiveFilters,
  type InboxFilters,
} from "@/lib/inbox/filters";
import { countMenuFilters, describeInboxFilters, type FilterSummaryCatalog } from "@/lib/inbox/filter-summary";
import { NEEDS_HUMAN_PARAM } from "@/lib/inbox/needs-human";
import { AWAITING_FILTER_LABELS, AWAITING_FILTER_VALUES, AWAITING_PARAM } from "@/lib/inbox/awaiting";
import { cn } from "@/lib/utils";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import { PlatformIcon } from "@/components/platform-icon";
import type { InboxAccount } from "@/lib/inbox/accounts";
import { useInboxUrl } from "@/components/inbox/use-inbox-url";
import { useDraftCounts, visibleDraftCount } from "@/components/drafts/use-draft-counts";
import { draftsQueueHref } from "@/lib/agent/drafts/destination";
import type { PendingDraftCounts } from "@/lib/agent/drafts/pending-count";

/**
 * Los filtros de la Bandeja (F16). Viven en el encabezado de la lista (`InboxListHeader`):
 *
 * - `InboxFiltersMenu`: el boton y su popover, con TODOS los filtros: canal, asignacion, estado, chats o grupos, y el
 *   resto. Flota: no empuja la lista.
 * - `InboxFilterSummary`: la linea de abajo del encabezado, con lo que esta filtrado en palabras y una `×` para
 *   limpiar. Sin filtros no se dibuja.
 * - `InboxDraftsLink`: el acceso a los borradores que esperan.
 *
 * Todos cambian la URL con `useInboxUrl`: el estado vive ahi y no en los componentes.
 */

export function InboxFiltersMenu({
  filters,
  accounts,
  tags,
  members,
  hasGroups,
}: {
  filters: InboxFilters;
  /** Las cuentas conectadas que esta persona ve: una opcion por cuenta, se marcan varias. */
  accounts: InboxAccount[];
  tags: { id: string; name: string; color: string | null }[];
  members: { userId: string; label: string }[];
  /** Hay grupos de WhatsApp activados: recien ahi tiene sentido elegir entre chats y grupos. */
  hasGroups: boolean;
}) {
  const { pending, setParam, setParams, toggle, clearAll } = useInboxUrl();
  const menuCount = countMenuFilters(filters);
  const anyAccount = filters.channelIds.length === 0 && filters.platforms.length === 0;

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
      plain
      align="left"
      value={
        menuCount > 0 ? (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {menuCount}
            <span className="sr-only"> {menuCount === 1 ? "filtro activo" : "filtros activos"}</span>
          </span>
        ) : null
      }
      menuClassName="topbar:w-[340px]"
    >
      <div className="space-y-1 pb-1.5">
        {accounts.length > 0 && (
          <FilterGroup label="Canal">
            <div className="flex flex-wrap gap-1.5">
              {/* "Todos" limpia las cuentas y tambien el `?canal=` de un link viejo. */}
              <Chip active={anyAccount} onClick={() => setParams({ cuenta: "", canal: "" })}>
                Todos
              </Chip>
              {accounts.map((account) => (
                <Chip key={account.id} active={filters.channelIds.includes(account.id)} onClick={() => toggle("cuenta", account.id)}>
                  <span className="inline-flex max-w-[15rem] items-center gap-1.5">
                    <PlatformIcon platform={account.platform} className="h-3.5 w-3.5 shrink-0" size={14} />
                    <span className="truncate">{account.label}</span>
                  </span>
                </Chip>
              ))}
            </div>
          </FilterGroup>
        )}

        <FilterGroup label="Asignación">
          <select
            value={filters.assignment}
            onChange={(e) => setParam("asignado", e.target.value)}
            aria-label="Filtrar por asignación"
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Todas</option>
            <option value={ASSIGNMENT_MINE}>Asignadas a mí</option>
            <option value={ASSIGNMENT_UNASSIGNED}>Sin asignar</option>
            <option value={ASSIGNMENT_AI}>Agente IA</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.label}
              </option>
            ))}
          </select>
        </FilterGroup>

        <FilterGroup label="Estado">
          <div className="flex flex-wrap gap-1.5">
            {INBOX_STATUS_VALUES.map((value) => (
              <Chip
                key={value}
                active={filters.status === value}
                onClick={() => setParam("estado", value === DEFAULT_INBOX_STATUS ? "" : value)}
              >
                {INBOX_STATUS_LABELS[value]}
              </Chip>
            ))}
          </div>
        </FilterGroup>

        {/* Sin grupos activados no hay nada que elegir; con el filtro puesto (un link) se puede sacar. */}
        {(hasGroups || filters.listType) && (
          <FilterGroup label="Chats y grupos">
            <div className="flex flex-wrap gap-1.5">
              <Chip active={!filters.listType} onClick={() => setParams({ [LIST_TYPE_PARAM]: "", [LEGACY_VIEW_PARAM]: "" })}>
                Ambos
              </Chip>
              {INBOX_LIST_TYPES.map((value) => (
                <Chip
                  key={value}
                  active={filters.listType === value}
                  onClick={() => setParams({ [LIST_TYPE_PARAM]: value, [LEGACY_VIEW_PARAM]: "" })}
                >
                  {INBOX_LIST_TYPE_LABELS[value]}
                </Chip>
              ))}
            </div>
          </FilterGroup>
        )}

        {/* 00259: el mismo criterio que la tarjeta "Esperando respuesta ahora"
            del dashboard. Se elige una de las dos o ninguna. */}
        <FilterGroup label="Respuesta">
          <div className="flex flex-wrap gap-1.5">
            {AWAITING_FILTER_VALUES.map((value) => (
              <Chip
                key={value}
                active={filters.awaiting === value}
                onClick={() => setParam(AWAITING_PARAM, filters.awaiting === value ? "" : value)}
              >
                {AWAITING_FILTER_LABELS[value]}
              </Chip>
            ))}
          </div>
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

        <FilterGroup label="Conocidos y clientes">
          <div className="flex flex-wrap gap-1.5">
            <Chip
              active={!!filters.hideKnown}
              onClick={() => setParam(HIDE_KNOWN_PARAM, filters.hideKnown ? "" : HIDE_KNOWN_VALUE)}
            >
              Ocultar conocidos
            </Chip>
            <Chip
              active={!!filters.hideCustomers}
              onClick={() => setParam(HIDE_CUSTOMERS_PARAM, filters.hideCustomers ? "" : HIDE_KNOWN_VALUE)}
            >
              Ocultar clientes
            </Chip>
          </div>
        </FilterGroup>

        {/* 00296: las que la lista oculta por defecto. */}
        <FilterGroup label="Quién es">
          <div className="flex flex-wrap gap-1.5">
            <Chip
              active={!!filters.onlyUnidentified}
              onClick={() => setParam(UNIDENTIFIED_PARAM, filters.onlyUnidentified ? "" : "1")}
            >
              Sin identificar
            </Chip>
          </div>
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
 * Cuantos chats oculta la lista por defecto (00296) y el link para verlos. Sin
 * esto, la lista baja de golpe y parece que se perdieron conversaciones.
 */
export function UnidentifiedNotice({ count }: { count: number }) {
  const { setParam } = useInboxUrl();
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={() => setParam(UNIDENTIFIED_PARAM, "1")}
      className="w-full border-b border-border bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {count === 1 ? "1 chat sin identificar" : `${count} chats sin identificar`}: todavía no respondieron.{" "}
      <span className="font-medium text-primary-ink">Ver</span>
    </button>
  );
}

/**
 * Lo filtrado, en una linea, debajo del encabezado de la lista (I3). Cuenta con la funcion de
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
    <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-border bg-muted/30 pl-3 pr-1">
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

/**
 * Bloque 2d: la cola de borradores vive aca y no en el menu. Un borrador es una conversacion esperando respuesta, no
 * otra seccion del sistema. Con cero no aparece.
 */
export function InboxDraftsLink({
  workspaceId,
  draftCounts,
}: {
  workspaceId: string;
  /** Valor inicial del contador de borradores; Realtime lo mantiene al dia. */
  draftCounts?: PendingDraftCounts;
}) {
  const drafts = useDraftCounts(workspaceId, draftCounts, "inbox-drafts");
  const waitingDrafts = visibleDraftCount(drafts);
  if (waitingDrafts === 0) return null;
  return (
    <Link
      href={draftsQueueHref(drafts)}
      aria-label={`Borradores: ${waitingDrafts} esperando`}
      title="Borradores esperando"
      className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-dashed border-amber-400 px-1.5 text-xs font-medium tabular-nums text-amber-800 transition-colors hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-950/30"
    >
      <FileText className="h-3.5 w-3.5" aria-hidden />
      {waitingDrafts}
    </Link>
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
          ? "border-primary-edge bg-primary/10 font-medium text-primary-ink"
          : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
