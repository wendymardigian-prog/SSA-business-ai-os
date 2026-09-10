"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";

/**
 * Server Actions del centro de notificaciones (F18).
 *
 * Todas son de LECTURA-MARCADO: marcar leido y nada mas. Crear notificaciones
 * no se expone —la tabla no tiene policy de INSERT— para que nadie pueda
 * fabricarle un aviso a otra persona.
 *
 * Quien puede marcar que es la RLS (can_see_notification): estas funciones no
 * repiten esa logica, solo la ejercen. Un update sobre un aviso que no le
 * corresponde no falla con error: no toca ninguna fila, que es lo correcto.
 */

export type NotificationActionResult = { ok: true; updated: number } | { ok: false; error: string };

/** Marca una notificacion como leida. */
export async function markNotificationRead(
  notificationId: string,
): Promise<NotificationActionResult> {
  const { supabase, workspace } = await getWorkspace();

  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("workspace_id", workspace.id)
    .is("read_at", null)
    .select("id");

  if (error) {
    console.error("[notificaciones] no pude marcar como leida:", error.message);
    return { ok: false, error: "No se pudo marcar como leida." };
  }

  revalidatePath("/dashboard");
  return { ok: true, updated: data?.length ?? 0 };
}

/**
 * Marca como leidas todas las que esta persona puede ver.
 *
 * El alcance de "todas" lo decide la RLS: para un Member son las suyas, para un
 * Owner/Admin las del workspace. Por eso el update no lleva mas filtro que el
 * workspace y el no-leidas.
 */
export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const { supabase, workspace } = await getWorkspace();

  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("workspace_id", workspace.id)
    .is("read_at", null)
    .select("id");

  if (error) {
    console.error("[notificaciones] no pude marcar todas como leidas:", error.message);
    return { ok: false, error: "No se pudieron marcar como leidas." };
  }

  revalidatePath("/dashboard");
  return { ok: true, updated: data?.length ?? 0 };
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/**
 * Las ultimas notificaciones visibles para esta persona.
 *
 * La campana la llama al abrirse y cuando Realtime avisa que hubo un cambio.
 * No hace falta filtrar por rol: la RLS ya devuelve solo lo que corresponde.
 */
export async function listNotifications(limit = 20): Promise<NotificationItem[]> {
  const { supabase, workspace } = await getWorkspace();

  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, body, entity_type, entity_id, metadata, read_at, created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));

  if (error) {
    console.error("[notificaciones] listado fallido:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

/** Cuantas sin leer. Alimenta el numerito de la campana. */
export async function countUnreadNotifications(): Promise<number> {
  const { supabase, workspace } = await getWorkspace();

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .is("read_at", null);

  if (error) {
    console.error("[notificaciones] no pude contar las no leidas:", error.message);
    return 0;
  }

  return count ?? 0;
}
