"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { NONE } from "@/lib/contacts/list-query";
import { loadCustomFieldRefs, loadKanbanColumn, prepareContactList } from "@/lib/contacts/list-load";
import { KANBAN_PAGE_SIZE, groupingRole, parseKanbanGrouping, type KanbanCard } from "@/lib/contacts/kanban";
import { parseContactSort } from "@/lib/contacts/sort";
import { STATUS_KEY_RE } from "@/lib/contacts/statuses";
import { firstParam, sanitizeSearch, searchParamsToRecord } from "@/lib/url-params";

/**
 * "Cargar más" de una columna del Kanban de contactos.
 *
 * Recibe la URL de la pantalla tal como está (los filtros, la búsqueda, el
 * orden y la agrupación) y la vuelve a leer con el MISMO parser que la página,
 * así la tanda nueva respeta exactamente lo que se ve. Lee con el cliente del
 * usuario: la RLS decide qué contactos ve. El workspace sale de la sesión.
 */
export async function loadContactsKanbanColumn(
  query: string,
  columnKey: string,
  offset: number,
): Promise<{ ok: true; cards: KanbanCard[] } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("contacts.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver contactos" };
  if (typeof query !== "string" || query.length > 8000) return { ok: false, error: "La vista no es válida" };
  if (columnKey !== NONE && !STATUS_KEY_RE.test(columnKey)) return { ok: false, error: "Esa columna no existe" };
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) return { ok: false, error: "No pude seguir cargando" };

  const params = searchParamsToRecord(new URLSearchParams(query));
  const search = sanitizeSearch(firstParam(params.q));
  const role = groupingRole(parseKanbanGrouping(params.agrupar));
  const customFields = await loadCustomFieldRefs(ctx.supabase, ctx.workspace.id);
  const { plan } = await prepareContactList(ctx.supabase, ctx.workspace.id, params, customFields, search);
  const column = await loadKanbanColumn(ctx.supabase, ctx.workspace.id, plan, role, columnKey, parseContactSort(params.orden), offset, KANBAN_PAGE_SIZE);
  if (column.failed) return { ok: false, error: "No pude cargar más contactos. Probá de nuevo." };
  return { ok: true, cards: column.cards };
}
