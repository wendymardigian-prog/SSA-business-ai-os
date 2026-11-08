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
import { UUID_RE, type CellMap } from "./filters/types";
import type { CustomFieldRef } from "./list-filters";
import { contactOrderClauses, type ContactSort } from "./sort";
import { KANBAN_CARD_SELECT, kanbanColumnClause, toKanbanCard, type KanbanAxis, type KanbanCard } from "./kanban";

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
  axis: KanbanAxis,
  key: string,
  sort: ContactSort,
  offset: number,
  limit: number,
): Promise<{ cards: KanbanCard[]; total: number; failed: boolean }> {
  const query = contactListQuery(supabase, workspaceId, KANBAN_CARD_SELECT, plan, [kanbanColumnClause(axis, key)]);
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

/** Cuántos contactos por pedido de columnas (una página de la tabla son 25). */
export const RELATED_CELLS_MAX_CONTACTS = 100;

/**
 * Las columnas de registros relacionados para estos contactos. Valida todo lo
 * que llega del navegador: ids con forma de uuid y del workspace (los que la
 * persona ve), y claves de columnas que existen y son "related". Cada área
 * carga lo suyo en paralelo; un área que falla deja sus columnas vacías.
 */
export async function loadRelatedCells(supabase: Client, workspaceId: string, contactIds: readonly unknown[], keys: readonly unknown[]): Promise<CellMap> {
  const ids = [...new Set(contactIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)))].slice(0, RELATED_CELLS_MAX_CONTACTS);
  const wanted = new Set(keys.filter((k): k is string => typeof k === "string"));
  if (ids.length === 0 || wanted.size === 0) return {};

  const { data: visible, error } = await supabase.from("contacts").select("id").eq("workspace_id", workspaceId).in("id", ids);
  if (error) {
    console.error("[contacts] columnas: no pude validar los contactos:", error.message);
    return {};
  }
  const allowed = (visible ?? []).map((c) => c.id);
  if (allowed.length === 0) return {};

  const parts = await Promise.all(
    CONTACT_LIST_MODULES.map(async (m) => {
      const own = m.columns.filter((c) => c.source === "related" && wanted.has(c.key)).map((c) => c.key);
      if (own.length === 0 || !m.loadCells) return {};
      try {
        return await m.loadCells(supabase, workspaceId, allowed, own);
      } catch (e) {
        console.error(`[contacts] columnas de ${m.key} fallidas:`, e instanceof Error ? e.message : "error");
        const empty: CellMap = {};
        for (const id of allowed) empty[id] = Object.fromEntries(own.map((k) => [k, null]));
        return empty;
      }
    }),
  );
  const out: CellMap = {};
  for (const part of parts) for (const [id, cells] of Object.entries(part)) out[id] = { ...(out[id] ?? {}), ...cells };
  return out;
}
