"use client";

import { MarkBadge } from "@/components/contacts/mark-badge";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Users, X, Plus, Upload, Loader2, ChevronLeft, ChevronRight, Tag, SlidersHorizontal, ArrowUpDown, Table2, KanbanSquare, Columns3 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DoNotContactBadge,
  TagChip,
  TemperatureBadge,
  formatRelative,
  ActionError,
} from "@/components/contacts/ui";
import { LEAD_TEMPERATURES, LEAD_TEMPERATURE_LABELS } from "@/lib/contacts/fields";
import { MEDIUMS, MEDIUM_LABELS, SOURCES, SOURCE_LABELS } from "@/lib/contacts/taxonomy";
import { bulkAddTag, createContact } from "@/lib/actions/contacts";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BULK_TAG_LIMIT, describeEffect, hasEffect, sortEffectFirst } from "@/lib/tags/effects";
import type { LeadTemperature } from "@/lib/types/database";
import { PageHeader } from "@/components/page-header";
import { FilterMenu, MenuGroupLabel, MenuOption } from "@/components/ui/filter-menu";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { LastStatusBadge } from "@/components/contacts/status-fields";
import { ColumnsMenu, CustomFieldFilter, useVisibleColumns } from "@/components/contacts/list-pipeline-controls";
import { type CustomFieldRef, type CustomFilterOp } from "@/lib/contacts/list-filters";
import {
  CONTACT_FILTER_PARAMS,
  MENU_FILTER_PARAMS,
  NONE,
  countActiveFilters,
  countMenuFilters,
  type ContactListFilters,
} from "@/lib/contacts/list-query";
import { MultiFilterField } from "@/components/ui/multi-filter-field";
import { ContactsKanban } from "@/components/contacts/contacts-kanban";
import {
  DEFAULT_KANBAN_GROUPING,
  KANBAN_GROUPINGS,
  KANBAN_GROUPING_STORAGE_KEY,
  groupingRole,
  parseKanbanGrouping,
  type ContactView,
  type KanbanColumn,
  type KanbanGrouping,
} from "@/lib/contacts/kanban";
import { STATUS_ROLE_LABELS, activeStatuses, statusName, type ContactStatus, type ContactStatusSettings } from "@/lib/contacts/statuses";
import { interestLabel, offeredProducts, type InterestCatalog } from "@/lib/contacts/interest";
import { displayCustomValue } from "@/lib/custom-fields";
import { EMAIL_STATUS_LABELS, EMAIL_STATUSES, type EmailStatus } from "@/lib/email/subscription";
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

/** Los parametros de la URL de cada filtro. */
const P = CONTACT_FILTER_PARAMS;

export interface ContactRow {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  lastInteractionAt: string | null;
  temperature: LeadTemperature | null;
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
}

export function ContactsView({
  contacts,
  total,
  page,
  pageSize,
  tags,
  platforms,
  members,
  filters,
  anonymousCount,
  sort,
  view,
  grouping,
  kanban,
  canEdit,
  customFilter,
  customFields,
  statusSettings,
  interestCatalog,
}: {
  contacts: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  tags: { id: string; name: string; color: string | null; disablesAgent?: boolean; assignsTo?: string | null }[];
  platforms: { value: string; label: string }[];
  members: { userId: string; label: string }[];
  filters: ContactListFilters;
  /** Cuantos contactos hay sin datos, esten o no en la lista. */
  anonymousCount: number;
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
  interestCatalog: InterestCatalog;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);

  const memberLabel = new Map(members.map((m) => [m.userId, m.label]));
  const memberOptions = [{ value: NONE, label: "Sin asignar" }, ...members.map((m) => ({ value: m.userId, label: m.label }))];
  // Las columnas opcionales (Estado, Producto, campos personalizados): preferencia de cada persona.
  const { columns: visibleColumns, toggle: toggleColumn } = useVisibleColumns(customFields.map((f) => f.id));
  const customColumns = customFields.filter((f) => visibleColumns.includes(`cf:${f.id}`));

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

  /** Un filtro de varias opciones: reemplaza la lista entera (`?setter=a&setter=b`). Vuelve a la pagina 1. */
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
            <FilterMenu
              label="Filtros"
              compact
              badge={menuFilterCount}
              active={menuFilterCount > 0}
              icon={<SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
              menuClassName="topbar:w-[340px]"
            >
              <div className="space-y-2 px-2.5 pb-2">
                <MenuGroupLabel>Asignación y etiquetas</MenuGroupLabel>
                <MultiFilterField
                  label="Etiqueta"
                  selected={filters.tagIds}
                  onChange={(v) => setList(P.tagIds, v)}
                  options={tags.map((t) => ({ value: t.id, label: t.name, color: t.color }))}
                />
                <MultiFilterField
                  label="Setter"
                  selected={filters.setterIds}
                  onChange={(v) => setList(P.setterIds, v)}
                  options={memberOptions}
                />
                <MultiFilterField
                  label="Vendedor"
                  selected={filters.vendedorIds}
                  onChange={(v) => setList(P.vendedorIds, v)}
                  options={memberOptions}
                />
                <MultiFilterField
                  label="Temperatura"
                  selected={filters.temperatures}
                  onChange={(v) => setList(P.temperatures, v)}
                  options={LEAD_TEMPERATURES.map((t) => ({ value: t, label: LEAD_TEMPERATURE_LABELS[t] }))}
                />
                <MultiFilterField
                  label="Estado de email"
                  selected={filters.emailStatuses}
                  onChange={(v) => setList(P.emailStatuses, v)}
                  options={EMAIL_STATUSES.map((st) => ({ value: st, label: EMAIL_STATUS_LABELS[st] }))}
                />

                {/* Pipeline (00245/00246): el ultimo estado, el de cada rol y el producto de interes. */}
                <MenuGroupLabel>Pipeline</MenuGroupLabel>
                <MultiFilterField
                  label="Último estado"
                  selected={filters.lastStatuses.map((st) => `${st.role}:${st.key}`)}
                  onChange={(v) => setList(P.lastStatuses, v)}
                  options={(["setter", "closer"] as const).flatMap((role) =>
                    activeStatuses(statusSettings[role]).map((st) => ({
                      value: `${role}:${st.key}`,
                      label: `${st.name} (${STATUS_ROLE_LABELS[role].toLowerCase()})`,
                      color: st.color,
                    })),
                  )}
                />
                <MultiFilterField
                  label="Estado de setter"
                  selected={filters.setterStatuses}
                  onChange={(v) => setList(P.setterStatuses, v)}
                  options={statusOptions(statusSettings.setter)}
                />
                <MultiFilterField
                  label="Estado de vendedor"
                  selected={filters.closerStatuses}
                  onChange={(v) => setList(P.closerStatuses, v)}
                  options={statusOptions(statusSettings.closer)}
                />
                {interestCatalog.length > 0 && (
                  <MultiFilterField
                    label="Producto de interés"
                    selected={filters.productIds}
                    onChange={(v) => setList(P.productIds, v)}
                    options={[{ value: NONE, label: "Sin producto" }, ...offeredProducts(interestCatalog, null).map((p) => ({ value: p.id, label: p.name }))]}
                  />
                )}
                <CustomFieldFilter
                  key={customFilter ? `${customFilter.slug}:${customFilter.op}:${customFilter.value}` : "none"}
                  fields={customFields}
                  current={customFilter}
                  onApply={(next) => setParams(next)}
                />

                {/* Por el PRIMER toque, y el nombre lo dice: "entraron por un comentario"
                    no es "alguna vez comentaron". */}
                <MenuGroupLabel>De dónde vinieron</MenuGroupLabel>
                <MultiFilterField
                  label="Origen (1.er toque)"
                  selected={filters.sources}
                  onChange={(v) => setList(P.sources, v)}
                  options={SOURCES.map((src) => ({ value: src, label: SOURCE_LABELS[src] }))}
                />
                <MultiFilterField
                  label="Medio (1.er toque)"
                  selected={filters.mediums}
                  onChange={(v) => setList(P.mediums, v)}
                  options={MEDIUMS.map((m) => ({ value: m, label: MEDIUM_LABELS[m] }))}
                />
                <MultiFilterField label="Canal" selected={filters.platforms} onChange={(v) => setList(P.platforms, v)} options={platforms} />

                {/* Los contactos sin datos se ocultan por defecto, asi que este
                    selector no arranca vacio como los otros: su opcion neutra ya es
                    una decision. */}
                {anonymousCount > 0 && (
                  <>
                    <MenuGroupLabel>Contactos sin datos</MenuGroupLabel>
                    <label className="block">
                      <span className="sr-only">Contactos sin datos</span>
                      <select
                        value={filters.anon}
                        onChange={(e) => setParam(P.anon, e.target.value)}
                        className={cn(
                          "w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
                          filters.anon ? "border-primary-edge" : "border-input",
                        )}
                      >
                        <option value="">Ocultos</option>
                        <option value="1">Incluidos</option>
                        <option value="solo">Solo esos</option>
                      </select>
                    </label>
                  </>
                )}

                {menuFilterCount > 0 && (
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-xs text-muted-foreground">
                      {menuFilterCount === 1 ? "1 filtro activo" : `${menuFilterCount} filtros activos`}
                    </span>
                    <button
                      type="button"
                      onClick={clearMenuFilters}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-3 w-3" aria-hidden />
                      Limpiar filtros
                    </button>
                  </div>
                )}
              </div>
            </FilterMenu>

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
              <ColumnsMenu fields={customFields} columns={visibleColumns} onToggle={toggleColumn} />
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
              role={groupingRole(grouping)}
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
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Nombre</th>
                {visibleColumns.includes("status") && <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Estado</th>}
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Contacto</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Setter</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Vendedor</th>
                {visibleColumns.includes("product") && <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Producto</th>}
                {visibleColumns.includes("email_status") && <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Email</th>}
                {customColumns.map((f) => (
                  <th key={f.id} className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">{f.name}</th>
                ))}
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Tags</th>
                <th className="px-4 py-3 text-xs font-medium uppercase text-muted-foreground">Última</th>
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
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/contacts/${contact.id}`} className="block">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {contact.displayName ?? "Sin nombre"}
                        </span>
                        <TemperatureBadge value={contact.temperature} />
                        {contact.doNotContact && <DoNotContactBadge />}
                        {contact.isCustomer && <MarkBadge mark="customer" />}
                        {contact.isKnown && <MarkBadge mark="known" />}
                      </span>
                    </Link>
                  </td>
                  {visibleColumns.includes("status") && (
                    <td className="px-4 py-3">
                      {contact.lastStatus ? (
                        <LastStatusBadge settings={statusSettings} role={contact.lastStatusRole} status={contact.lastStatus} compact />
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/contacts/${contact.id}`} className="block text-sm">
                      <span className="block text-muted-foreground">{contact.email ?? "—"}</span>
                      {contact.phone && (
                        <span className="block text-xs text-muted-foreground/70">{contact.phone}</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {contact.setterId ? (memberLabel.get(contact.setterId) ?? "—") : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {contact.vendedorId ? (memberLabel.get(contact.vendedorId) ?? "—") : "—"}
                  </td>
                  {visibleColumns.includes("product") && (
                    <td className="max-w-48 truncate px-4 py-3 text-sm text-muted-foreground">
                      {interestLabel(interestCatalog, contact.interestProductId, contact.interestVariantId)}
                    </td>
                  )}
                  {visibleColumns.includes("email_status") && (
                    <td className="px-4 py-3">
                      <EmailStatusBadge status={contact.emailStatus} prefix="" />
                    </td>
                  )}
                  {customColumns.map((f) => (
                    <td key={f.id} className="max-w-48 truncate px-4 py-3 text-sm text-muted-foreground">
                      {displayCustomValue(f.type, contact.custom[f.id]) || "—"}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {contact.tags.map((tag) => (
                        <TagChip key={tag.id} name={tag.name} color={tag.color} />
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatRelative(contact.lastInteractionAt)}
                  </td>
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

/** Los estados de un rol para el filtro: "Sin estado" y todos (los archivados lo dicen en el nombre). */
function statusOptions(list: readonly ContactStatus[]) {
  return [{ value: NONE, label: "Sin estado" }, ...list.map((st) => ({ value: st.key, label: statusName(list, st.key), color: st.color }))];
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
