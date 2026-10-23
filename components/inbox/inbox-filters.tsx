"use client";

import Link from "next/link";
import { SlidersHorizontal, X, Loader2, FileText, Check, Inbox } from "lucide-react";
import { DATE_PRESETS, DATE_PRESET_LABELS } from "@/lib/dates";
import {
  INBOX_STATUS_VALUES,
  INBOX_STATUS_LABELS,
  DEFAULT_INBOX_STATUS,
  ASSIGNMENT_UNASSIGNED,
  ASSIGNMENT_AI,
  ASSIGNMENT_MINE,
  HIDE_KNOWN_PARAM,
  HIDE_KNOWN_VALUE,
  countActiveFilters,
  type InboxFilters,
} from "@/lib/inbox/filters";
import { countMenuFilters, describeInboxFilters, type FilterSummaryCatalog } from "@/lib/inbox/filter-summary";
import { NEEDS_HUMAN_PARAM } from "@/lib/inbox/needs-human";
import { cn } from "@/lib/utils";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import { PlatformIcon } from "@/components/platform-icon";
import { accountFilterLabel, groupAccounts, type InboxAccount } from "@/lib/inbox/accounts";
import { useInboxUrl } from "@/components/inbox/use-inbox-url";
import { useDraftCounts, visibleDraftCount } from "@/components/drafts/use-draft-counts";
import { draftsQueueHref } from "@/lib/agent/drafts/destination";
import type { PendingDraftCounts } from "@/lib/actions/agent-drafts";

/**
 * Los filtros de la Bandeja (F16), repartidos en el Bloque I:
 *
 * - `InboxChannelMenu`: el menu de Canal. Una opcion por CUENTA conectada,
 *   agrupadas por red (dos Instagram son dos lineas). Se pueden marcar varias.
 * - `InboxFiltersMenu`: el boton de la barra superior y su popover (I3). Tags,
 *   agente, asignacion y fecha. Flota: no empuja la lista.
 * - `InboxFilterSummary`: la linea de abajo de la barra, con lo que esta
 *   filtrado en palabras y una `×` para limpiar. Sin filtros no se dibuja.
 * - `InboxStatusControls`: el desplegable de estado y el link a borradores, en
 *   la linea del titulo de la lista (I6). Es el filtro que mas se usa y no se
 *   esconde detras de un clic.
 *
 * El buscador es `SectionSearch` (`components/comunicacion/section-search.tsx`),
 * compartido con las otras tres secciones. Todos cambian la URL con
 * `useInboxUrl`: el estado vive ahi y no en los componentes.
 */

/**
 * El menu de Canal: todas las cuentas conectadas, agrupadas por red, una por linea.
 *
 * Se marcan varias a la vez (por ejemplo las dos cuentas de Instagram y nada mas) y el menu NO se cierra al elegir,
 * como los chips del popover de Filtros. "Todos los canales" limpia las cuentas y tambien el `?canal=` de un link
 * viejo. Sin cuentas conectadas el menu no se dibuja: no hay nada que elegir.
 */
export function InboxChannelMenu({
  filters,
  accounts,
  multiPlatforms,
}: {
  filters: InboxFilters;
  accounts: InboxAccount[];
  /** Las redes con mas de una cuenta: ahi el boton nombra la cuenta ("Instagram @marca"). */
  multiPlatforms: string[];
}) {
  const { pending, setParams, toggle } = useInboxUrl();
  if (accounts.length === 0) return null;

  const selected = filters.channelIds;
  const legacyPlatforms = filters.platforms.length;
  const active = selected.length > 0 || legacyPlatforms > 0;
  const groups = groupAccounts(accounts);

  let value: string;
  if (selected.length === 0 && legacyPlatforms === 0) value = "Todos";
  else if (selected.length === 1) {
    const account = accounts.find((a) => a.id === selected[0]);
    value = account ? accountFilterLabel(account, multiPlatforms) : "1 cuenta";
  } else if (selected.length > 1) value = `${selected.length} cuentas`;
  else value = legacyPlatforms === 1 ? "1 red" : `${legacyPlatforms} redes`;

  return (
    <FilterMenu
      label="Canal"
      active={active}
      icon={
        pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Inbox className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        )
      }
      value={<span className="max-w-[9rem] truncate">{value}</span>}
      menuClassName="topbar:w-[300px]"
    >
      <div className="space-y-0.5 pb-1">
        <AccountRow
          checked={!active}
          onClick={() => setParams({ cuenta: "", canal: "" })}
          title="Todos los canales"
        />
        {groups.map((group) => (
          <div key={group.platform}>
            <MenuGroupLabel>{group.platformLabel}</MenuGroupLabel>
            {group.accounts.map((account) => (
              <AccountRow
                key={account.id}
                checked={selected.includes(account.id)}
                onClick={() => toggle("cuenta", account.id)}
                title={account.label}
                leading={<PlatformIcon platform={account.platform} className="h-4 w-4" size={16} />}
              />
            ))}
          </div>
        ))}
      </div>
    </FilterMenu>
  );
}

/** Una cuenta del menu: una casilla que se prende y se apaga sin cerrar el menu. */
function AccountRow({
  checked,
  onClick,
  title,
  leading,
}: {
  checked: boolean;
  onClick: () => void;
  title: string;
  leading?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{leading}</span>
      <span className={cn("min-w-0 flex-1 truncate", checked && "font-medium")}>{title}</span>
      {checked && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}

export function InboxFiltersMenu({
  filters,
  tags,
  members,
}: {
  filters: InboxFilters;
  tags: { id: string; name: string; color: string | null }[];
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

        <FilterGroup label="Conocidos">
          <div className="flex flex-wrap gap-1.5">
            <Chip
              active={!!filters.hideKnown}
              onClick={() => setParam(HIDE_KNOWN_PARAM, filters.hideKnown ? "" : HIDE_KNOWN_VALUE)}
            >
              Ocultar conocidos
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

/**
 * El estado y el link a borradores, en la misma linea que el titulo de la
 * lista (I6, compactado el 23/10/2026).
 *
 * Antes eran cuatro pastillas en una fila propia, debajo del titulo: en el
 * celular eran dos filas enteras antes del primer chat. El estado sigue afuera
 * del popover de Filtros —es el que mas se usa y no se esconde detras de un
 * clic—, pero como un desplegable que entra al lado del titulo.
 */
export function InboxStatusControls({
  filters,
  workspaceId,
  draftCounts,
}: {
  filters: InboxFilters;
  workspaceId: string;
  /** Valor inicial del contador de borradores; Realtime lo mantiene al dia. */
  draftCounts?: PendingDraftCounts;
}) {
  const { setParam } = useInboxUrl();
  const drafts = useDraftCounts(workspaceId, draftCounts, "inbox-drafts");
  const waitingDrafts = visibleDraftCount(drafts);
  const notDefault = filters.status !== DEFAULT_INBOX_STATUS;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <select
        value={filters.status}
        onChange={(e) => setParam("estado", e.target.value)}
        aria-label="Estado de los chats"
        className={cn(
          "h-8 rounded-lg border pl-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring",
          notDefault ? "border-primary bg-primary/10 text-primary" : "border-input bg-background",
        )}
      >
        {INBOX_STATUS_VALUES.map((value) => (
          <option key={value} value={value}>
            {INBOX_STATUS_LABELS[value]}
          </option>
        ))}
      </select>
      {/* Bloque 2d: la cola de borradores vive aca y no en el menu. Un
          borrador es una conversacion esperando respuesta, no otra seccion
          del sistema. Con cero no aparece. */}
      {waitingDrafts > 0 && (
        <Link
          href={draftsQueueHref(drafts)}
          aria-label={`Borradores: ${waitingDrafts} esperando`}
          title="Borradores esperando"
          className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-dashed border-amber-400 px-1.5 text-xs font-medium tabular-nums text-amber-800 transition-colors hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-950/30"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          {waitingDrafts}
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
