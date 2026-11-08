"use client";

import { useViewerTimezone } from "@/components/dashboard-chrome";
import { MarkBadge } from "@/components/contacts/mark-badge";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Users, X, Plus, Upload, Loader2, ChevronLeft, ChevronRight, Tag, ArrowUpDown, Table2, KanbanSquare, Columns3, Radio } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DoNotContactBadge,
  TagChip,
  TemperatureBadge,
  formatRelative,
  ActionError,
} from "@/components/contacts/ui";
import { bulkAddTag, createContact } from "@/lib/actions/contacts";
import { loadContactColumnCells } from "@/lib/actions/contacts-columns";
import { createBroadcast } from "@/lib/actions/broadcasts";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BULK_TAG_LIMIT, describeEffect, hasEffect, sortEffectFirst } from "@/lib/tags/effects";
import type { LeadTemperature } from "@/lib/types/database";
import { PageHeader } from "@/components/page-header";
import { FilterMenu, MenuGroupLabel, MenuOption } from "@/components/ui/filter-menu";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { LastStatusBadge } from "@/components/contacts/status-fields";
import { ContactColumnsMenu, useColumnPrefs } from "@/components/contacts/columns-menu";
import { ContactFiltersPanel } from "@/components/contacts/filters-panel";
import { ActiveFilterChips } from "@/components/contacts/active-filter-chips";
import { ContactCell } from "@/components/contacts/contact-cell";
import { type CustomFieldRef, type CustomFilterOp } from "@/lib/contacts/list-filters";
import { CUSTOM_FILTER_PARAMS, MENU_FILTER_PARAMS, countActiveFilters, countMenuFilters, type ContactListFilters } from "@/lib/contacts/list-query";
import { CONTACT_FILTERS } from "@/lib/contacts/list-modules";
import { allColumns } from "@/lib/contacts/columns";
import type { CellMap, CellValue, ContactColumnDef } from "@/lib/contacts/filters/types";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";
import { ContactsKanban } from "@/components/contacts/contacts-kanban";
import {
  DEFAULT_KANBAN_GROUPING,
  KANBAN_GROUPINGS,
  KANBAN_GROUPING_STORAGE_KEY,
  groupingAxis,
  parseKanbanGrouping,
  type ContactView,
  type KanbanColumn,
  type KanbanGrouping,
} from "@/lib/contacts/kanban";
import type { ContactStatusSettings } from "@/lib/contacts/statuses";
import type { QualificationSettings } from "@/lib/contacts/qualification";
import { QualificationBadge } from "@/components/contacts/qualification-badge";
import { interestLabel, type InterestCatalog } from "@/lib/contacts/interest";
import { displayCustomValue } from "@/lib/custom-fields";
import type { EmailStatus } from "@/lib/email/subscription";
import { EmailStatusBadge } from "@/components/contacts/email-status-badge";
import {
  CONTACT_SORTS,
  CONTACT_SORT_HINTS,
  CONTACT_SORT_LABELS,
  DEFAULT_CONTACT_SORT,
  type ContactSort,
} from "@/lib/contacts/sort";

/**
 * Lista de contactos.
 *
 * Los filtros no filtran nada en el cliente: escriben la URL y el Server
 * Component vuelve a consultar. Asi la paginacion es real y una vista filtrada
 * se puede compartir por link.
 */

export interface ContactRow {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  lastInteractionAt: string | null;
  temperature: LeadTemperature | null;
  /** Nivel de calificación 1-5 (00329). */
  qualificationLevel: number | null;
  doNotContact: boolean;
  /** Conocido (00256). */
  isKnown?: boolean;
  isCustomer?: boolean;
  /** Suscripcion a emails (00270). */
  emailStatus: EmailStatus;
  setterId: string | null;
  vendedorId: string | null;
  tags: { id: string; name: string; color: string | null }[];
  /** Pipeline (00245): el ultimo estado. */
  lastStatusRole: "setter" | "closer" | null;
  lastStatus: string | null;
  /** El estado de cada rol (00245): las columnas del Kanban. */
  setterStatus: string | null;
  closerStatus: string | null;
  /** Producto de interes (00246). */
  interestProductId: string | null;
  interestVariantId: string | null;
  /** Campos personalizados: id del campo -> valor guardado. */
  custom: Record<string, string>;
  /** Las columnas del catálogo que salen del contacto o de sus registros (`lib/contacts/columns*.ts`). */
  cells: Record<string, CellValue>;
}

/** Sin contactos sin datos, el filtro de anónimos no tiene nada que hacer. */
const HIDE_ANON: ReadonlySet<string> = new Set(["anon"]);

export function ContactsView({
  contacts,
  total,
  page,
  pageSize,
  tags,
  filterOptions,
  members,
  filters,
  anonymousCount,
  sort,
  canBroadcast = false,
  view,
  grouping,
  kanban,
  canEdit,
  customFilter,
  customFields,
  statusSettings,
  qualificationSettings,
  interestCatalog,
}: {
  contacts: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  tags: { id: string; name: string; color: string | null; disablesAgent?: boolean; assignsTo?: string | null }[];
  /** Las opciones de los filtros que salen de datos del workspace (`lib/contacts/filters/options.ts`). */
  filterOptions: Record<string, MultiFilterOption[]>;
  members: { userId: string; label: string }[];
  filters: ContactListFilters;
  /** Cuantos contactos hay sin datos, esten o no en la lista. */
  anonymousCount: number;
  /** Quien puede mandar broadcasts ve "Mandar un broadcast a estos contactos" con los filtros puestos. */
  canBroadcast?: boolean;
  /** El orden de la lista (`?orden=`). */
  sort: ContactSort;
  /** Tabla o Kanban (`?vista=`), y por qué estado se agrupa el Kanban (`?agrupar=`). */
  view: ContactView;
  grouping: KanbanGrouping;
  /** Las columnas del Kanban; null en la tabla. */
  kanban: KanbanColumn[] | null;
  /** Puede cambiar estados (`contacts.edit`): sin esto las tarjetas no se arrastran. */
  canEdit: boolean;
  customFilter: { slug: string; op: CustomFilterOp; value: string } | null;
  customFields: CustomFieldRef[];
  statusSettings: ContactStatusSettings;
  qualificationSettings: QualificationSettings;
  interestCatalog: InterestCatalog;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [creatingBroadcast, startBroadcast] = useTransition();
  const [creating, setCreating] = useState(false);

  const memberLabel = new Map(members.map((m) => [m.userId, m.label]));
  // Las columnas: el catálogo (`lib/contacts/columns.ts`) y lo que eligió cada persona.
  const columnDefs = useMemo(() => allColumns(customFields), [customFields]);
  const columnPrefs = useColumnPrefs(columnDefs);
  const shownColumns = useMemo(() => {
    const visible = new Set(columnPrefs.visible);
    return columnDefs.filter((c) => visible.has(c.key));
  }, [columnDefs, columnPrefs.visible]);
  const customById = new Map(customFields.map((f) => [f.id, f]));
  const related = useRelatedCells(
    view === "tabla" ? contacts.map((c) => c.id) : [],
    shownColumns.filter((c) => c.source === "related").map((c) => c.key),
  );

  // Seleccion para la accion masiva (Bloque 2d-A). Vale para la pagina que se
  // esta mirando: lo que ya no esta en pantalla no cuenta.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // El resultado de la ultima accion masiva: la barra se cierra al terminar.
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const pageIds = contacts.map((c) => c.id);
  const selected = pageIds.filter((id) => picked.has(id));
  const allOnPage = selected.length > 0 && selected.length === pageIds.length;
  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePage() {
    setPicked(allOnPage ? new Set() : new Set(pageIds));
  }
  // Los filtros puestos. La busqueda cuenta aparte (tiene su propio indicador en
  // la lupa): el globito del boton de filtros es solo de lo que esta adentro del menu.
  const activeCount = countActiveFilters(filters);
  const menuFilterCount = countMenuFilters(filters);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  /** Escribe un parametro en la URL. Cualquier cambio de filtro vuelve a la pagina 1. */
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  }

  /** Varios parametros a la vez (el filtro por campo escribe tres). Vuelve a la pagina 1. */
  function setParams(patch: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  }

  /** Un filtro: reemplaza la lista entera (`?setter=a&setter=b`, o un solo valor). Vuelve a la pagina 1. */
  function setList(key: string, values: readonly string[]) {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(key);
    for (const v of values) next.append(key, v);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  }

  /**
   * Cambia de vista. Al pasar al Kanban sin una agrupación en la URL, usa la
   * última que eligió esta persona (localStorage, siempre en try/catch).
   */
  function changeView(next: ContactView) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (next === "kanban") {
      params.set("vista", "kanban");
      if (!params.get("agrupar")) {
        let saved: string | null = null;
        try {
          saved = window.localStorage.getItem(KANBAN_GROUPING_STORAGE_KEY);
        } catch {
          saved = null;
        }
        const remembered = parseKanbanGrouping(saved ?? undefined);
        if (remembered !== DEFAULT_KANBAN_GROUPING) params.set("agrupar", remembered);
      }
    } else {
      params.delete("vista");
      params.delete("agrupar");
    }
    setPicked(new Set());
    start(() => router.replace(`${pathname}?${params.toString()}`));
  }

  function changeGrouping(next: KanbanGrouping) {
    try {
      window.localStorage.setItem(KANBAN_GROUPING_STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento (modo privado): la elección vale solo para esta URL.
    }
    setParam("agrupar", next === DEFAULT_KANBAN_GROUPING ? "" : next);
  }

  function clearAll() {
    start(() => router.replace(pathname));
  }

  /** Quita los filtros del menu y deja la busqueda y el orden como estan. */
  function clearMenuFilters() {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of [...MENU_FILTER_PARAMS, "page"]) next.delete(key);
    const query = next.toString();
    start(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/contacts"
        left={
          <span className="flex shrink-0 items-center gap-2">
          <nav aria-label="Vista" className="flex shrink-0 rounded-lg bg-muted/60 p-0.5">
            {([["tabla", "Tabla", Table2], ["kanban", "Kanban", KanbanSquare]] as const).map(([option, label, Icon]) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => view !== option && changeView(option)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm",
                  view === option ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
                <span className="sr-only sm:hidden">{label}</span>
              </button>
            ))}
          </nav>
          {/* El total solo con espacio de sobra: con el selector de vista al lado, a
              1024 px empujaba el titulo hasta desaparecer. */}
          <span className="hidden truncate text-xs text-muted-foreground xl:inline">
            {total} {total === 1 ? "contacto" : "contactos"}
            {activeCount > 0 && " con los filtros aplicados"}
            {/* Que la lista pase de 171 a 72 sin decir por que parece que se
                perdieron contactos. */}
            {!filters.anon && anonymousCount > 0 && (
              <span className="text-muted-foreground/70">
                {" · "}
                {anonymousCount} sin datos {anonymousCount === 1 ? "oculto" : "ocultos"}
              </span>
            )}
          </span>
          </span>
        }
        filters={
          <>
            <ExpandableSearch
              value={filters.search}
              onCommit={(next) => setParam("q", next)}
              label="Buscar contactos"
              placeholder="Nombre, email, teléfono o usuario…"
              pending={pending}
            />
            <ContactFiltersPanel
              defs={CONTACT_FILTERS}
              filters={filters}
              options={filterOptions}
              customFields={customFields}
              customFilter={customFilter}
              hidden={anonymousCount > 0 ? undefined : HIDE_ANON}
              activeCount={menuFilterCount}
              onList={setList}
              onParams={setParams}
              onClear={clearMenuFilters}
            />

            {view === "kanban" ? (
              // Solo icono, como Filtros y Columnas: con el nombre no entraba en la barra
              // a 1024 px. Las columnas del tablero ya dicen por qué se agrupa.
              <FilterMenu
                label={`Agrupar por: ${KANBAN_GROUPINGS.find((g) => g.key === grouping)?.label ?? ""}`}
                compact
                active={false}
                icon={<Columns3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                menuClassName="topbar:w-[240px]"
              >
                <MenuGroupLabel>Columnas del Kanban</MenuGroupLabel>
                {KANBAN_GROUPINGS.map((g) => (
                  <MenuOption key={g.key} checked={grouping === g.key} onSelect={() => changeGrouping(g.key)} title={g.label} />
                ))}
              </FilterMenu>
            ) : (
              <ContactColumnsMenu
                defs={columnDefs}
                visible={columnPrefs.visible}
                onToggle={columnPrefs.toggle}
                onShowAll={columnPrefs.showAll}
                onReset={columnPrefs.reset}
              />
            )}

            {/* Los ajustes de la tabla: hoy, el orden. */}
            <FilterMenu
              label="Ordenar por"
              compact
              active={sort !== DEFAULT_CONTACT_SORT}
              icon={<ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
              menuClassName="topbar:w-[260px]"
            >
              <MenuGroupLabel>Ordenar por</MenuGroupLabel>
              {CONTACT_SORTS.map((option) => (
                <MenuOption
                  key={option}
                  checked={sort === option}
                  onSelect={() => setParam("orden", option === DEFAULT_CONTACT_SORT ? "" : option)}
                  title={CONTACT_SORT_LABELS[option]}
                  description={CONTACT_SORT_HINTS[option]}
                />
              ))}
            </FilterMenu>
          </>
        }
        right={
          <div className="flex shrink-0 gap-2">
            <Link
              href="/dashboard/contacts/import"
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Importar CSV</span>
            </Link>
            <button
              onClick={() => setCreating(true)}
              className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nuevo contacto</span>
            </button>
          </div>
        }
      />

      <ActiveFilterChips
        defs={CONTACT_FILTERS}
        filters={filters}
        options={filterOptions}
        onRemove={(param) => setList(param, [])}
        onRemoveCustom={() => setParams(Object.fromEntries(CUSTOM_FILTER_PARAMS.map((k) => [k, ""])))}
        onClear={clearMenuFilters}
      />

      {canBroadcast && activeCount > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs md:px-8">
          <button
            type="button"
            disabled={creatingBroadcast}
            onClick={() =>
              startBroadcast(async () => {
                // Los mismos parametros de la URL: el broadcast arranca con exactamente esta audiencia.
                const res = await createBroadcast({ audienceQuery: searchParams.toString() });
                if (res.ok) router.push(`/dashboard/broadcasts/${res.id}`);
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium text-primary-ink hover:bg-accent disabled:opacity-50"
          >
            <Radio className="h-3.5 w-3.5" aria-hidden />
            Mandar un broadcast a estos contactos
          </button>
        </div>
      )}

      {bulkNotice && (
        <div role="status" className="flex items-center justify-between gap-2 border-b border-border bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200 md:px-8">
          <span>{bulkNotice}</span>
          <button type="button" onClick={() => setBulkNotice(null)} aria-label="Cerrar el aviso" className="rounded p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900/40">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {view === "kanban" && kanban ? (
        <div className="min-h-0 flex-1">
          {total === 0 && activeCount === 0 ? (
            <EmptyState filtered={false} onClear={clearAll} onCreate={() => setCreating(true)} />
          ) : (
            <ContactsKanban
              columns={kanban}
              axis={groupingAxis(grouping)}
              qualificationSettings={qualificationSettings}
              canEdit={canEdit}
              memberLabel={memberLabel}
              interestCatalog={interestCatalog}
            />
          )}
        </div>
      ) : (
      <div className="flex-1 overflow-auto">
        {contacts.length === 0 ? (
          <EmptyState filtered={activeCount > 0} onClear={clearAll} onCreate={() => setCreating(true)} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="w-10 py-3 pl-4 pr-0">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.length > 0 && !allOnPage;
                    }}
                    onChange={togglePage}
                    aria-label="Seleccionar todos los contactos de esta página"
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                </th>
                {shownColumns.map((col) => (
                  <th key={col.key} className="whitespace-nowrap px-4 py-3 text-xs font-medium uppercase text-muted-foreground">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr
                  key={contact.id}
                  className={cn("border-b border-border transition-colors hover:bg-accent/40", picked.has(contact.id) && "bg-primary/5")}
                >
                  <td className="w-10 py-3 pl-4 pr-0">
                    <input
                      type="checkbox"
                      checked={picked.has(contact.id)}
                      onChange={() => togglePick(contact.id)}
                      aria-label={`Seleccionar a ${contact.displayName ?? "este contacto"}`}
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                  </td>
                  {shownColumns.map((col) => (
                    <TableCell
                      key={col.key}
                      col={col}
                      contact={contact}
                      memberLabel={memberLabel}
                      statusSettings={statusSettings}
                      qualificationSettings={qualificationSettings}
                      interestCatalog={interestCatalog}
                      customField={col.key.startsWith("cf:") ? customById.get(col.key.slice(3)) : undefined}
                      related={related[contact.id]}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      )}

      {view === "tabla" && lastPage > 1 && (
        <div className="flex items-center justify-between border-t border-border px-8 py-3">
          <p className="text-xs text-muted-foreground">
            Página {page} de {lastPage}
          </p>
          <div className="flex gap-2">
            <PageButton
              disabled={page <= 1}
              onClick={() => setParam("page", String(page - 1))}
              label="Anterior"
              icon={<ChevronLeft className="h-3.5 w-3.5" />}
            />
            <PageButton
              disabled={page >= lastPage}
              onClick={() => setParam("page", String(page + 1))}
              label="Siguiente"
              icon={<ChevronRight className="h-3.5 w-3.5" />}
              iconRight
            />
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <BulkTagBar
          contactIds={selected}
          tags={tags}
          memberLabel={memberLabel}
          onCancel={() => setPicked(new Set())}
          onDone={(text) => {
            setPicked(new Set());
            setBulkNotice(text);
            router.refresh();
          }}
        />
      )}

      {creating && <NewContactDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

/**
 * Las columnas de registros relacionados (agendas, ventas, tareas…) de la
 * página que se ve, solo las visibles. Se piden al servidor después de dibujar
 * la tabla (qué columnas se ven vive en el navegador) y se guardan mientras se
 * mira la misma página: prender otra columna pide solo lo que falta.
 */
function useRelatedCells(contactIds: readonly string[], keys: readonly string[]): CellMap {
  const pageKey = contactIds.join(",");
  const [cache, setCache] = useState<{ pageKey: string; cells: CellMap }>({ pageKey: "", cells: {} });
  const inflight = useRef(new Set<string>());
  const cells = cache.pageKey === pageKey ? cache.cells : {};
  const missing = keys.filter((k) => contactIds.some((id) => !(k in (cells[id] ?? {}))));
  const request = missing.length > 0 && contactIds.length > 0 ? `${pageKey}|${missing.join(",")}` : "";

  useEffect(() => {
    if (!request || inflight.current.has(request)) return;
    inflight.current.add(request);
    const [page, wanted] = request.split("|");
    loadContactColumnCells(page.split(","), wanted.split(","))
      .then((result) => {
        if (!result.ok) return;
        setCache((prev) => {
          const base = prev.pageKey === page ? prev.cells : {};
          const next: CellMap = { ...base };
          for (const [id, row] of Object.entries(result.cells)) next[id] = { ...(next[id] ?? {}), ...row };
          // Lo que no volvió (un contacto que ya no se ve) queda vacío, no cargando para siempre.
          for (const id of page.split(",")) for (const k of wanted.split(",")) if (!(k in (next[id] ?? {}))) next[id] = { ...(next[id] ?? {}), [k]: null };
          return { pageKey: page, cells: next };
        });
      })
      .catch(() => {
        // Sin conexión: las celdas quedan vacías en vez de girar para siempre.
        setCache((prev) => {
          const next: CellMap = prev.pageKey === page ? { ...prev.cells } : {};
          for (const id of page.split(",")) for (const k of wanted.split(",")) next[id] = { ...(next[id] ?? {}), [k]: next[id]?.[k] ?? null };
          return { pageKey: page, cells: next };
        });
      })
      .finally(() => inflight.current.delete(request));
  }, [request]);

  return cells;
}

/** Una celda de la tabla. Las "special" se dibujan acá; el resto sale de `contact.cells` (`ContactCell`). */
function TableCell({
  col,
  contact,
  memberLabel,
  statusSettings,
  qualificationSettings,
  interestCatalog,
  customField,
  related,
}: {
  col: ContactColumnDef;
  contact: ContactRow;
  /** Las columnas de registros relacionados que ya llegaron (`useRelatedCells`). */
  related?: Record<string, CellValue>;
  memberLabel: Map<string, string>;
  statusSettings: ContactStatusSettings;
  qualificationSettings: QualificationSettings;
  interestCatalog: InterestCatalog;
  customField?: CustomFieldRef;
}) {
  const timeZone = useViewerTimezone();
  const muted = "px-4 py-3 text-sm text-muted-foreground";
  switch (col.key) {
    case "name":
      return (
        <td className="px-4 py-3">
          <Link href={`/dashboard/contacts/${contact.id}`} className="block">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{contact.displayName ?? "Sin nombre"}</span>
              <TemperatureBadge value={contact.temperature} />
              {contact.doNotContact && <DoNotContactBadge />}
              {contact.isCustomer && <MarkBadge mark="customer" />}
              {contact.isKnown && <MarkBadge mark="known" />}
            </span>
          </Link>
        </td>
      );
    case "status":
      return (
        <td className="px-4 py-3">
          {contact.lastStatus ? (
            <LastStatusBadge settings={statusSettings} role={contact.lastStatusRole} status={contact.lastStatus} compact />
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </td>
      );
    case "qualification":
      return (
        <td className="px-4 py-3">
          {contact.qualificationLevel ? (
            <QualificationBadge settings={qualificationSettings} level={contact.qualificationLevel} />
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </td>
      );
    case "setter_status":
    case "closer_status": {
      const role = col.key === "setter_status" ? "setter" : "closer";
      const status = role === "setter" ? contact.setterStatus : contact.closerStatus;
      return (
        <td className="px-4 py-3">
          {status ? <LastStatusBadge settings={statusSettings} role={role} status={status} compact /> : <span className="text-sm text-muted-foreground">—</span>}
        </td>
      );
    }
    case "contact":
      return (
        <td className="px-4 py-3">
          <Link href={`/dashboard/contacts/${contact.id}`} className="block text-sm">
            <span className="block text-muted-foreground">{contact.email ?? "—"}</span>
            {contact.phone && <span className="block text-xs text-muted-foreground/70">{contact.phone}</span>}
          </Link>
        </td>
      );
    case "setter":
      return <td className={muted}>{contact.setterId ? (memberLabel.get(contact.setterId) ?? "—") : "—"}</td>;
    case "vendedor":
      return <td className={muted}>{contact.vendedorId ? (memberLabel.get(contact.vendedorId) ?? "—") : "—"}</td>;
    case "product":
      return <td className={cn(muted, "max-w-48 truncate")}>{interestLabel(interestCatalog, contact.interestProductId, contact.interestVariantId)}</td>;
    case "email_status":
      return (
        <td className="px-4 py-3">
          <EmailStatusBadge status={contact.emailStatus} prefix="" />
        </td>
      );
    case "tags":
      return (
        <td className="px-4 py-3">
          <span className="flex flex-wrap gap-1">
            {contact.tags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} color={tag.color} />
            ))}
          </span>
        </td>
      );
    case "last_interaction":
      return <td className={muted}>{formatRelative(contact.lastInteractionAt, timeZone)}</td>;
  }
  if (customField) {
    return <td className={cn(muted, "max-w-48 truncate")}>{displayCustomValue(customField.type, contact.custom[customField.id]) || "—"}</td>;
  }
  return (
    <td className="px-4 py-3 text-sm">
      {col.source === "related" ? (
        <ContactCell value={related?.[col.key]} loading={!related || !(col.key in related)} memberLabel={memberLabel} />
      ) : (
        <ContactCell value={contact.cells[col.key]} memberLabel={memberLabel} />
      )}
    </td>
  );
}

function PageButton({
  disabled,
  onClick,
  label,
  icon,
  iconRight,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  iconRight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-lg border border-input px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      {!iconRight && icon}
      {label}
      {iconRight && icon}
    </button>
  );
}

/**
 * Dos estados vacios distintos: "todavia no hay nada" pide conectar un canal,
 * "el filtro no encontro nada" pide limpiar el filtro. Mostrar el primero
 * cuando en realidad hay contactos hace pensar que se perdieron los datos.
 */
function EmptyState({
  filtered,
  onClear,
  onCreate,
}: {
  filtered: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Users className="h-10 w-10 text-muted-foreground/40" />
      {filtered ? (
        <>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Ningún contacto coincide con estos filtros
          </p>
          <button
            onClick={onClear}
            className="mt-3 rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            Limpiar filtros
          </button>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Todavía no hay contactos
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground/70">
            Se crean solos cuando alguien escribe por un canal conectado. También
            los podés cargar a mano.
          </p>
          <button
            onClick={onCreate}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Nuevo contacto
          </button>
        </>
      )}
    </div>
  );
}

/** Alta manual. Los mismos campos minimos que pide la deduplicacion: nombre, email o telefono. */
function NewContactDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState({ display_name: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = await createContact(values);
      if (!result.ok) {
        setError(result.error);
        setDuplicateId(result.duplicate ? (result.contactId ?? null) : null);
        return;
      }
      router.push(`/dashboard/contacts/${result.contactId}`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="text-base font-semibold">Nuevo contacto</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Con el teléfono o el email alcanza para que no se duplique más adelante.
        </p>

        <div className="mt-4 space-y-3">
          {(
            [
              ["display_name", "Nombre", "text"],
              ["email", "Email", "email"],
              ["phone", "Teléfono", "tel"],
            ] as const
          ).map(([key, label, type]) => (
            <div key={key}>
              <label htmlFor={`new-${key}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                {label}
              </label>
              <input
                id={`new-${key}`}
                type={type}
                value={values[key]}
                onChange={(e) => {
                  setValues((prev) => ({ ...prev, [key]: e.target.value }));
                  setError(null);
                }}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          ))}
        </div>

        <ActionError message={error} />

        {duplicateId && (
          <Link
            href={`/dashboard/contacts/${duplicateId}`}
            className="mt-2 inline-block text-sm font-medium underline underline-offset-2"
          >
            Ir a la ficha del contacto que ya existe
          </Link>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * La barra de la accion masiva (Bloque 2d-A): etiquetar los contactos
 * seleccionados. Ana va a marcar varias decenas de conocidos de una
 * sentada. Una etiqueta con efecto pide confirmacion con las consecuencias.
 */
function BulkTagBar({
  contactIds,
  tags,
  memberLabel,
  onCancel,
  onDone,
}: {
  contactIds: string[];
  tags: { id: string; name: string; color: string | null; disablesAgent?: boolean; assignsTo?: string | null }[];
  memberLabel: Map<string, string>;
  onCancel: () => void;
  onDone: (summary: string) => void;
}) {
  const [tagId, setTagId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const options = sortEffectFirst(tags.map((t) => ({ ...t, disablesAgent: t.disablesAgent ?? false, assignsTo: t.assignsTo ?? null })));
  const chosen = options.find((t) => t.id === tagId) ?? null;
  const effect = chosen ? describeEffect(chosen, chosen.assignsTo ? (memberLabel.get(chosen.assignsTo) ?? null) : null) : null;
  const tooMany = contactIds.length > BULK_TAG_LIMIT;

  function apply() {
    if (!chosen) return;
    setMessage(null);
    start(async () => {
      const result = await bulkAddTag(contactIds, chosen.id);
      if (!result.ok) return setMessage({ tone: "error", text: result.error });
      const parts = [`${result.tagged} ${result.tagged === 1 ? "contacto etiquetado" : "contactos etiquetados"}`];
      if (result.alreadyHad) parts.push(`${result.alreadyHad} ya la tenían`);
      if (result.notAllowed) parts.push(`${result.notAllowed} fuera de tu alcance`);
      onDone(`«${chosen.name}»: ${parts.join(" · ")}`);
    });
  }

  return (
    <div className="sticky bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur md:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {contactIds.length} {contactIds.length === 1 ? "seleccionado" : "seleccionados"}
        </span>
        <select
          value={tagId}
          onChange={(e) => {
            setTagId(e.target.value);
            setMessage(null);
          }}
          aria-label="Etiqueta para los seleccionados"
          className="min-h-11 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring md:min-h-0"
        >
          <option value="">Elegí una etiqueta…</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {hasEffect(t) ? `${t.name} (apaga el agente)` : t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => (chosen && hasEffect(chosen) ? setConfirming(true) : apply())}
          disabled={!chosen || pending || tooMany}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 md:min-h-0"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
          Etiquetar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-input px-3 py-2 text-sm hover:bg-accent md:min-h-0"
        >
          Cancelar
        </button>
      </div>
      {effect && <p className="mt-1.5 text-xs text-red-700 dark:text-red-300">«{chosen?.name}»: {effect}.</p>}
      {tooMany && <p className="mt-1.5 text-xs text-red-700 dark:text-red-300">Hasta {BULK_TAG_LIMIT} contactos por vez.</p>}
      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn("mt-1.5 text-xs", message.tone === "error" ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300")}
        >
          {message.text}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title={`¿Marcar ${contactIds.length} ${contactIds.length === 1 ? "contacto" : "contactos"} como «${chosen?.name ?? ""}»?`}
        message={`${effect ?? ""}. Los que ya la tenían no se tocan.`}
        confirmLabel="Etiquetar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          setConfirming(false);
          apply();
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
