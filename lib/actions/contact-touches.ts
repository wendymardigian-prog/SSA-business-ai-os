"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { TOUCHES_PAGE_SIZE, TOUCH_COLUMNS, type TouchRow } from "@/lib/attribution/attribution";
import type { TouchNames } from "@/lib/attribution/touch-label";

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
  /** Los titulos de las piezas y los nombres de los anuncios de estos toques (Extra I, F46). Lo que no se ve, no esta. */
  names: TouchNames;
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

  // Los nombres, con la sesion de quien mira: lo que la RLS no deja ver (el catalogo de Meta pide `dashboards.ads.view`)
  // queda afuera y el toque se nombra con lo que trae. Un fallo aca nunca rompe el selector.
  const names: TouchNames = { pieces: {}, ads: {} };
  try {
    const pieceIds = [...new Set(touches.map((t) => t.content_post_id).filter((id): id is string => !!id))];
    const adIds = [...new Set(touches.map((t) => t.meta_ad_id ?? t.ad_id).filter((id): id is string => !!id))];
    const [pieces, ads] = await Promise.all([
      pieceIds.length > 0 ? supabase.from("content_posts").select("id, title").eq("workspace_id", workspace.id).in("id", pieceIds) : null,
      adIds.length > 0 ? supabase.from("meta_ads").select("ad_id, name").eq("workspace_id", workspace.id).in("ad_id", adIds) : null,
    ]);
    for (const p of pieces?.data ?? []) names.pieces[p.id] = p.title;
    for (const a of ads?.data ?? []) if (a.name) names.ads[a.ad_id] = a.name;
  } catch (err) {
    console.error("[contact-touches] no pude leer los nombres:", err instanceof Error ? err.message : "error desconocido");
  }

  return { ok: true, data: { touches, nextCursor: all.length > TOUCHES_PAGE_SIZE ? touches[touches.length - 1].occurred_at : null, names } };
}
