/**
 * Lo que la lista de contactos le pide a la base, para la tabla, el Kanban y
 * "Cargar más" de una columna. Siempre con el cliente del USUARIO: la RLS
 * (`can_see_contact`) decide qué contactos ve cada persona, y los filtros se
 * aplican sobre eso.
 *
 * La regla de qué filtra cada cosa no vive acá: está en `list-query.ts` (puro).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { SearchParams } from "@/lib/url-params";
import { contactSearchFilter } from "./search";
import { contactIdsByWhatsappLid } from "./search-lid";
import { applyListClauses, contactListPlan, contactListSelect, parseContactListFilters, type ContactListFilters, type ContactListPlan, type ListClause, type PlanContext } from "./list-query";
import { CONTACT_LIST_MODULES } from "./list-modules";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";
import type { CustomFieldRef } from "./list-filters";
import { contactOrderClauses, type ContactSort } from "./sort";
import { KANBAN_CARD_SELECT, kanbanColumnClause, toKanbanCard, type KanbanCard } from "./kanban";
import type { StatusRole } from "./statuses";

type Client = SupabaseClient<Database>;

/** Los filtros de la URL y el plan de la consulta (la búsqueda necesita una consulta previa por el @lid). */
export async function prepareContactList(
  supabase: Client,
  workspaceId: string,
  params: SearchParams,
  customFields: readonly CustomFieldRef[],
  search: string,
  ctx: PlanContext,
): Promise<{ filters: ContactListFilters; plan: ContactListPlan }> {
  const filters = parseContactListFilters(params, customFields, search);
  let searchFilter: string | null = null;
  if (search) {
    // La misma regla de búsqueda que la bandeja (lib/contacts/search.ts): además de
    // nombre, emails, teléfonos y los @, el teléfono escrito con espacios y el id de
    // WhatsApp de quien escribió sin número.
    const lidContactIds = await contactIdsByWhatsappLid(supabase, workspaceId, search);
    searchFilter = contactSearchFilter(search, lidContactIds);
  }
  return { filters, plan: contactListPlan(filters, searchFilter, ctx) };
}

/** La consulta de contactos vivos del workspace con el plan (y alguna condición más) aplicado. */
export function contactListQuery(supabase: Client, workspaceId: string, base: string, plan: ContactListPlan, extra: readonly ListClause[] = []) {
  const query = supabase
    .from("contacts")
    .select(contactListSelect(base, plan), { count: "exact" })
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  return applyListClauses(query, [...plan.clauses, ...extra]);
}

/** Los campos personalizados del workspace (el filtro por campo necesita su tipo). */
export async function loadCustomFieldRefs(supabase: Client, workspaceId: string): Promise<CustomFieldRef[]> {
  const { data, error } = await supabase
    .from("custom_field_definitions")
    .select("id, slug, name, type")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("name");
  if (error) console.error("[contacts] no pude leer los campos personalizados:", error.message);
  return data ?? [];
}

/** Una tanda de tarjetas de una columna del Kanban, con el total de la columna. */
export async function loadKanbanColumn(
  supabase: Client,
  workspaceId: string,
  plan: ContactListPlan,
  role: StatusRole,
  key: string,
  sort: ContactSort,
  offset: number,
  limit: number,
): Promise<{ cards: KanbanCard[]; total: number; failed: boolean }> {
  const query = contactListQuery(supabase, workspaceId, KANBAN_CARD_SELECT, plan, [kanbanColumnClause(role, key)]);
  const ordered = contactOrderClauses(sort).reduce(
    (q, clause) => q.order(clause.column, { ascending: clause.ascending, nullsFirst: clause.nullsFirst }),
    query,
  );
  const { data, count, error } = await ordered.range(offset, offset + limit - 1);
  if (error) {
    console.error("[contacts] columna del kanban fallida:", error.message);
    return { cards: [], total: 0, failed: true };
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return { cards: rows.map(toKanbanCard), total: count ?? 0, failed: false };
}

/**
 * Las opciones de los filtros de cada área (formularios, tipos de evento,
 * campañas…). Con el cliente del usuario. Un área que falla deja sus filtros
 * sin opciones, nunca la pantalla sin lista.
 */
export async function loadModuleFilterOptions(supabase: Client, workspaceId: string): Promise<Record<string, MultiFilterOption[]>> {
  const parts = await Promise.all(
    CONTACT_LIST_MODULES.map(async (m) => {
      if (!m.loadOptions) return {};
      try {
        return await m.loadOptions(supabase, workspaceId);
      } catch (e) {
        console.error(`[contacts] opciones de filtros de ${m.key} fallidas:`, e instanceof Error ? e.message : "error");
        return {};
      }
    }),
  );
  return Object.assign({}, ...parts);
}
