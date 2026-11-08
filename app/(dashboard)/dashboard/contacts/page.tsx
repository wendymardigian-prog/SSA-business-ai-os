import { getWorkspace } from "@/lib/workspace";
import { requirePermission } from "@/lib/auth/guards";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { ContactsView, type ContactRow } from "./contacts-view";
import type { LeadTemperature } from "@/lib/types/database";
import { platformLabel } from "@/lib/platforms";
import { contactOrderClauses, parseContactSort, type ContactSort } from "@/lib/contacts/sort";
import { firstParam, pickPage, sanitizeSearch } from "@/lib/url-params";
import { customFilterRawValue, filterValues, type ContactListFilters, type ContactListPlan } from "@/lib/contacts/list-query";
import { contactListQuery, loadCustomFieldRefs, loadKanbanColumn, loadModuleFilterOptions, prepareContactList } from "@/lib/contacts/list-load";
import { coreFilterOptions } from "@/lib/contacts/filters/options";
import { contactCells } from "@/lib/contacts/columns";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import {
  KANBAN_PAGE_SIZE,
  groupingAxis,
  axisFilterParam,
  qualificationColumnDefs,
  kanbanColumnDefs,
  parseContactView,
  parseKanbanGrouping,
  visibleKanbanColumns,
  type KanbanColumn,
  type KanbanGrouping,
} from "@/lib/contacts/kanban";
import type { ContactStatusSettings } from "@/lib/contacts/statuses";
import { loadContactStatusSettings } from "@/lib/contacts/status-settings-load";
import { loadQualificationSettings } from "@/lib/contacts/qualification-settings-load";
import type { QualificationSettings } from "@/lib/contacts/qualification";
import { loadInterestCatalog } from "@/lib/contacts/interest-load";
import { isEmailStatus } from "@/lib/email/subscription";

/**
 * Lista de contactos.
 *
 * Antes traia 100 contactos fijos y filtraba en memoria. Ahora la busqueda,
 * los filtros y la paginacion se resuelven en la base, por tres motivos:
 *
 * 1. Con el scope de leads prendido, "todos los contactos" ya no es lo mismo
 *    para cada persona; filtrar en el cliente sobre una tanda arbitraria
 *    mostraba resultados incompletos sin avisar.
 * 2. Buscar por telefono o por usuario de red necesita indices, no un
 *    Array.filter.
 * 3. Con datos reales, 100 filas se quedan cortas enseguida.
 *
 * El estado de los filtros vive en la URL, asi que una vista filtrada se puede
 * compartir o guardar en favoritos.
 *
 * Dos vistas con los MISMOS filtros (`lib/contacts/list-query.ts`): la tabla
 * paginada y el Kanban (`?vista=kanban`), una columna por estado de setter o de
 * vendedor (`?agrupar=`), cada una con su total y sus primeras tarjetas.
 */

const PAGE_SIZE = 25;

type Client = Awaited<ReturnType<typeof getWorkspace>>["supabase"];

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Equipo y roles (F21): la pagina pide su permiso; el alcance de los contactos lo sigue aplicando la RLS.
  const permission = await requirePermission("contacts.view");
  const { workspace, supabase } = await getWorkspace();

  const search = sanitizeSearch(firstParam(params.q));
  const page = pickPage(params.page);
  // El orden de la lista (`?orden=`): una lista cerrada, con el de siempre por defecto.
  const sort = parseContactSort(params.orden);
  const view = parseContactView(params.vista);
  const grouping = parseKanbanGrouping(params.agrupar);

  // Los campos personalizados (para el filtro y las columnas), las listas de
  // estados y el catalogo de productos: se piden antes porque el filtro por
  // campo necesita saber su tipo.
  const [customFields, statusSettings, interestCatalog, timeZone, qualificationSettings] = await Promise.all([
    loadCustomFieldRefs(supabase, workspace.id),
    loadContactStatusSettings(workspace.id),
    loadInterestCatalog(supabase, workspace.id),
    // "Hoy" y "los últimos 7 días" de los filtros de fecha son los de quien mira.
    resolveViewerTimezone(workspace.timezone),
    loadQualificationSettings(workspace.id),
  ]);

  // Todos los filtros salen de la URL y se validan en UN lugar
  // (lib/contacts/list-query.ts): lo mismo que filtra la tabla filtra el Kanban.
  const { filters, plan } = await prepareContactList(supabase, workspace.id, params, customFields, search, { now: new Date(), timeZone });

  // Cuantos quedaron afuera por ser anonimos. Sin este numero, la lista pasa de
  // 171 a 72 sin explicacion y parece que se perdieron contactos.
  const anonymousQuery = supabase
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .eq("is_anonymous", true);

  const [listing, tagsRes, channelsRes, members, anonymousRes, moduleOptions] = await Promise.all([
    view === "kanban"
      ? loadKanban(supabase, workspace.id, plan, statusSettings, qualificationSettings, grouping, filters, sort)
      : loadTablePage(supabase, workspace.id, plan, sort, page, customFields.length > 0),
    supabase.from("tags").select("id, name, color, disables_agent, assigns_to").eq("workspace_id", workspace.id).order("name"),
    supabase.from("channels").select("platform").eq("workspace_id", workspace.id).eq("is_active", true),
    getWorkspaceMembers(workspace.id),
    anonymousQuery,
    loadModuleFilterOptions(supabase, workspace.id),
  ]);

  const platforms = [...new Set((channelsRes.data ?? []).map((c) => c.platform))].sort();
  const tags = (tagsRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    disablesAgent: t.disables_agent,
    assignsTo: t.assigns_to,
  }));
  const memberRefs = members.map((m) => ({ userId: m.userId, label: m.name }));
  const filterOptions = {
    ...coreFilterOptions({
      members: memberRefs,
      tags,
      platforms: platforms.map((p) => ({ value: p, label: platformLabel(p) })),
      statusSettings,
      interestCatalog,
      qualificationSettings,
    }),
    ...moduleOptions,
  };

  return (
    <ContactsView
      contacts={listing.contacts}
      total={listing.total}
      page={page}
      pageSize={PAGE_SIZE}
      view={view}
      grouping={grouping}
      kanban={listing.kanban}
      canEdit={permission.can("contacts.edit")}
      canBroadcast={permission.can("broadcasts.manage")}
      tags={tags}
      filterOptions={filterOptions}
      members={memberRefs}
      filters={filters}
      customFilter={filters.custom ? { slug: filters.custom.field.slug, op: filters.custom.op, value: customFilterRawValue(params) } : null}
      customFields={customFields}
      statusSettings={statusSettings}
      qualificationSettings={qualificationSettings}
      interestCatalog={interestCatalog}
      anonymousCount={anonymousRes.count ?? 0}
      sort={sort}
    />
  );
}

interface Listing {
  contacts: ContactRow[];
  total: number;
  kanban: KanbanColumn[] | null;
}

/**
 * El Kanban: una consulta por columna, en paralelo. Cada una trae su total con
 * los filtros puestos y sus primeras tarjetas. Si se filtra por estados del
 * mismo rol que se agrupa, solo esas columnas.
 */
async function loadKanban(
  supabase: Client,
  workspaceId: string,
  plan: ContactListPlan,
  statusSettings: ContactStatusSettings,
  qualificationSettings: QualificationSettings,
  grouping: KanbanGrouping,
  filters: ContactListFilters,
  sort: ContactSort,
): Promise<Listing> {
  const axis = groupingAxis(grouping);
  const filtered = filterValues(filters, axisFilterParam(axis));
  const defs = axis === "qualification" ? qualificationColumnDefs(qualificationSettings, filtered) : kanbanColumnDefs(statusSettings[axis], filtered);
  const loaded = await Promise.all(
    defs.map(async (def) => {
      const column = await loadKanbanColumn(supabase, workspaceId, plan, axis, def.key, sort, 0, KANBAN_PAGE_SIZE);
      return { ...def, cards: column.cards, total: column.total };
    }),
  );
  const kanban = visibleKanbanColumns(loaded);
  return { contacts: [], total: kanban.reduce((sum, c) => sum + c.total, 0), kanban };
}

/** La tabla: una pagina de contactos con sus etiquetas y los valores de los campos personalizados. */
async function loadTablePage(
  supabase: Client,
  workspaceId: string,
  plan: ContactListPlan,
  sort: ContactSort,
  page: number,
  withCustomFields: boolean,
): Promise<Listing> {
  const from = (page - 1) * PAGE_SIZE;
  const query = contactListQuery(supabase, workspaceId, "*, contact_tags(tag_id, tags(id, name, color))", plan);
  const contactsRes = await contactOrderClauses(sort)
    .reduce((q, clause) => q.order(clause.column, { ascending: clause.ascending, nullsFirst: clause.nullsFirst }), query)
    .range(from, from + PAGE_SIZE - 1);

  if (contactsRes.error) {
    console.error("[contacts] listado fallido:", contactsRes.error.message);
  }

  // El select dinamico no se puede tipar en tiempo de compilacion, asi que la
  // forma se fija aca, en un solo lugar.
  const rows = (contactsRes.data ?? []) as unknown as Array<
    Record<string, unknown> & {
      contact_tags?: { tags: { id: string; name: string; color: string | null } | null }[];
    }
  >;

  // Los valores de los campos personalizados de ESTA pagina (para las columnas que la persona elija).
  const pageIds = rows.map((c) => c.id as string);
  const customValues: Record<string, Record<string, string>> = {};
  if (pageIds.length > 0 && withCustomFields) {
    const { data: values } = await supabase.from("contact_custom_fields").select("contact_id, field_id, value").in("contact_id", pageIds);
    for (const v of values ?? []) (customValues[v.contact_id] ??= {})[v.field_id] = v.value;
  }

  const contacts: ContactRow[] = rows.map((c) => ({
    id: c.id as string,
    displayName: (c.display_name as string | null) ?? null,
    email: (c.email as string | null) ?? null,
    phone: (c.phone as string | null) ?? null,
    lastInteractionAt: (c.last_interaction_at as string | null) ?? null,
    temperature: (c.lead_temperature as LeadTemperature | null) ?? null,
    qualificationLevel: typeof c.qualification_level === "number" ? c.qualification_level : null,
    doNotContact: Boolean(c.do_not_contact),
    isKnown: Boolean(c.is_known),
    isCustomer: Boolean(c.is_customer),
    emailStatus: isEmailStatus(c.email_status) ? c.email_status : "subscribed",
    setterId: (c.setter_id as string | null) ?? null,
    vendedorId: (c.vendedor_id as string | null) ?? null,
    tags: (c.contact_tags ?? [])
      .map((ct) => ct.tags)
      .filter((t): t is { id: string; name: string; color: string | null } => Boolean(t)),
    lastStatusRole: c.last_status_role === "setter" || c.last_status_role === "closer" ? c.last_status_role : null,
    lastStatus: (c.last_status as string | null) ?? null,
    setterStatus: (c.setter_status as string | null) ?? null,
    closerStatus: (c.closer_status as string | null) ?? null,
    interestProductId: (c.interest_product_id as string | null) ?? null,
    interestVariantId: (c.interest_variant_id as string | null) ?? null,
    custom: customValues[c.id as string] ?? {},
    cells: contactCells(c),
  }));

  return { contacts, total: contactsRes.count ?? 0, kanban: null };
}
