"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { loadRelatedCells } from "@/lib/contacts/list-load";
import type { CellMap } from "@/lib/contacts/filters/types";

/**
 * Las columnas de registros relacionados (agendas, ventas, tareas…) de la
 * página de contactos que se está viendo, solo las que la persona tiene
 * visibles. Se piden desde el navegador porque qué columnas se ven es una
 * preferencia guardada ahí.
 *
 * Lee con el cliente del usuario: la RLS de cada tabla decide qué cuenta. El
 * workspace sale de la sesión, y los contactos se recortan a los del workspace
 * que la persona ve antes de cargar nada.
 */
export async function loadContactColumnCells(contactIds: string[], keys: string[]): Promise<{ ok: true; cells: CellMap } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("contacts.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver contactos" };
  if (!Array.isArray(contactIds) || !Array.isArray(keys)) return { ok: false, error: "Pedido inválido" };
  const cells = await loadRelatedCells(ctx.supabase, ctx.workspace.id, contactIds, keys);
  return { ok: true, cells };
}
