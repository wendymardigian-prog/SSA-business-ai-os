"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { TOUCHES_PAGE_SIZE, TOUCH_COLUMNS, type TouchRow } from "@/lib/sales/attribution";

/**
 * Los toques de un contacto, para elegir con cuál se atribuye una venta (F11).
 *
 * Pide `sales.view`, y lee con el cliente de QUIEN MIRA: la RLS de `contacts`
 * (el alcance de leads) decide qué contactos ve. Un contacto que no ve es como
 * si no existiera. `select` con columnas, nunca `*`.
 */
export interface ContactTouchesPage {
  touches: TouchRow[];
  /** `occurred_at` del último toque devuelto, para pedir los anteriores; null si no hay más. */
  nextCursor: string | null;
}

export async function listContactTouches(input: { contactId: string; cursor?: string | null }): Promise<
  { ok: true; data: ContactTouchesPage } | { ok: false; error: string }
> {
  const ctx = await getPermissionAction("sales.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para ver las ventas" };
  const { workspace, supabase } = ctx;

  // La visibilidad del contacto la decide la RLS (can_see_contact).
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", input.contactId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return { ok: false, error: "No tenés permiso para ver los toques de este contacto" };

  let query = supabase
    .from("contact_touches")
    .select(TOUCH_COLUMNS)
    .eq("contact_id", input.contactId)
    .eq("workspace_id", workspace.id)
    .order("occurred_at", { ascending: false })
    .limit(TOUCHES_PAGE_SIZE + 1);
  if (input.cursor) query = query.lt("occurred_at", input.cursor);

  const { data, error } = await query;
  if (error) {
    console.error("[contact-touches] no pude leer:", error.message);
    return { ok: false, error: "No pude leer los toques" };
  }

  const all = (data ?? []) as unknown as TouchRow[];
  const touches = all.slice(0, TOUCHES_PAGE_SIZE);
  return { ok: true, data: { touches, nextCursor: all.length > TOUCHES_PAGE_SIZE ? touches[touches.length - 1].occurred_at : null } };
}
