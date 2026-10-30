"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { getMyNotificationPrefs } from "@/lib/account/notification-prefs";
import { mutedBellTypes } from "@/lib/notifications/preferences";
import { bellRecipientFilter, mutedTypesList } from "@/lib/notifications/bell-filter";

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
 *
 * Encima de la RLS, la campana muestra solo lo propio y lo general, sin lo que
 * la persona silencio (Mi cuenta → Notificaciones, `lib/notifications/bell-filter.ts`).
 */

/** El filtro de la campana de quien esta logueado: lo propio y lo general, sin lo silenciado. */
async function bellScope() {
  const [{ supabase, workspace, user }, prefs] = await Promise.all([getWorkspace(), getMyNotificationPrefs()]);
  return { supabase, workspace, recipients: bellRecipientFilter(user.id), muted: mutedTypesList(mutedBellTypes(prefs)) };
}

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
 * Marca como leidas todas las que esta persona ve en SU campana: las propias y
 * las generales (no las personales de otros, aunque la RLS se las deje ver a
 * un Owner/Admin), y no las que silencio.
 */
export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const { supabase, workspace, recipients, muted } = await bellScope();

  let query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("workspace_id", workspace.id)
    .is("read_at", null)
    .or(recipients);
  if (muted) query = query.not("type", "in", muted);
  const { data, error } = await query.select("id");

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
 * Las ultimas notificaciones de la campana de esta persona.
 *
 * La campana la llama al abrirse y cuando Realtime avisa que hubo un cambio.
 * La RLS decide que puede ver; `bellScope` deja lo propio y lo general, sin lo silenciado.
 */
export async function listNotifications(limit = 20): Promise<NotificationItem[]> {
  const { supabase, workspace, recipients, muted } = await bellScope();

  let query = supabase
    .from("notifications")
    .select("id, type, title, body, entity_type, entity_id, metadata, read_at, created_at")
    .eq("workspace_id", workspace.id)
    .or(recipients);
  if (muted) query = query.not("type", "in", muted);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 50));

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
  const { supabase, workspace, recipients, muted } = await bellScope();

  let query = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .is("read_at", null)
    .or(recipients);
  if (muted) query = query.not("type", "in", muted);
  const { count, error } = await query;

  if (error) {
    console.error("[notificaciones] no pude contar las no leidas:", error.message);
    return 0;
  }

  return count ?? 0;
}
