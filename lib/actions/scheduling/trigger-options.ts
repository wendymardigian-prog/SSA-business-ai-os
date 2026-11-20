"use server";

import { getAnyPermissionAction } from "@/lib/auth/guards";

/**
 * Las listas de los filtros de los disparadores de Agenda en el lienzo: eventos y áreas/tipos. Lo abre quien arma
 * automatizaciones; lee con la sesión (la RLS decide qué ve). Antes estos filtros solo se podían poner creando el flujo
 * desde el evento. En un archivo `"use server"` todo lo exportado es una función asincrónica.
 */
export async function loadBookingTriggerOptions(): Promise<
  | { ok: true; eventTypes: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }> }
  | { ok: false; error: string }
> {
  const ctx = await getAnyPermissionAction(["flows.edit", "flows.view"]);
  if (!ctx) return { ok: false, error: "No tenés permiso para ver los eventos." };
  const [events, categories] = await Promise.all([
    ctx.supabase.from("event_types").select("id, title, status").eq("workspace_id", ctx.workspace.id).order("title", { ascending: true }),
    ctx.supabase.from("booking_categories").select("id, name, parent_id, archived_at").eq("workspace_id", ctx.workspace.id).is("archived_at", null).order("name", { ascending: true }),
  ]);
  if (events.error || categories.error) {
    console.error("[agenda] no pude leer las opciones de los disparadores:", events.error?.message ?? categories.error?.message);
    return { ok: false, error: "No pude cargar los eventos." };
  }
  const cats = (categories.data ?? []) as Array<{ id: string; name: string; parent_id: string | null }>;
  const byId = new Map(cats.map((c) => [c.id, c]));
  return {
    ok: true,
    eventTypes: ((events.data ?? []) as Array<{ id: string; title: string; status: string }>).map((e) => ({ id: e.id, name: e.status === "inactive" ? `${e.title} (inactivo)` : e.title })),
    // El tipo se muestra con su área («Ventas › Discovery»).
    categories: cats.map((c) => ({ id: c.id, name: c.parent_id && byId.get(c.parent_id) ? `${byId.get(c.parent_id)!.name} › ${c.name}` : c.name })),
  };
}
