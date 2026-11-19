"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { getMyNotificationPrefs } from "@/lib/account/notification-prefs";
import { mutedBellTypes } from "@/lib/notifications/preferences";
import { bellRecipientFilter, mutedTypesList } from "@/lib/notifications/bell-filter";
import { BELL_COUNT_CAP } from "@/lib/notifications/bell-count";
import { NOTIFICATIONS_PAGE_SIZE, type NotificationView } from "@/lib/notifications/page-view";

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

export interface NotificationsPageData {
  items: NotificationItem[];
  counts: { unread: number; all: number; read: number };
  /** Hay otra página detrás de esta. */
  hasMore: boolean;
}

/**
 * Una página de la pantalla completa de notificaciones (`/dashboard/notificaciones`): la vista elegida, 50 por
 * página, y los contadores de las pestañas. Mismo alcance que la campana (`bellScope`). Acá sí se cuenta exacto:
 * es una pantalla que se abre a propósito, no cada carga de página como el numerito de la campana.
 */
export async function listNotificationsPage(view: NotificationView, page: number): Promise<NotificationsPageData> {
  const { supabase, workspace, recipients, muted } = await bellScope();
  const size = NOTIFICATIONS_PAGE_SIZE;
  const from = (Math.max(page, 1) - 1) * size;

  const base = (select: string, head = false) => {
    let q = supabase
      .from("notifications")
      .select(select, head ? { count: "exact", head: true } : undefined)
      .eq("workspace_id", workspace.id)
      .or(recipients);
    if (muted) q = q.not("type", "in", muted);
    return q;
  };

  let list = base("id, type, title, body, entity_type, entity_id, metadata, read_at, created_at");
  if (view === "no-leidas") list = list.is("read_at", null);
  if (view === "leidas") list = list.not("read_at", "is", null);

  const [rows, all, unread] = await Promise.all([
    // Una fila de más para saber si hay otra página.
    list.order("created_at", { ascending: false }).range(from, from + size),
    base("id", true),
    base("id", true).is("read_at", null),
  ]);

  const failed = rows.error ?? all.error ?? unread.error;
  if (failed) console.error("[notificaciones] pantalla completa fallida:", failed.message);

  const data = (rows.data ?? []) as unknown as Array<{
    id: string; type: string; title: string; body: string | null; entity_type: string | null;
    entity_id: string | null; metadata: unknown; read_at: string | null; created_at: string;
  }>;
  const allCount = all.count ?? 0;
  const unreadCount = unread.count ?? 0;

  return {
    items: data.slice(0, size).map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
    counts: { unread: unreadCount, all: allCount, read: Math.max(0, allCount - unreadCount) },
    hasMore: data.length > size,
  };
}

/**
 * Cuantas sin leer, hasta `BELL_COUNT_CAP`. Alimenta el numerito de la campana,
 * que nunca muestra mas que «9+» (`lib/notifications/bell-count.ts`).
 *
 * Sin `count: "exact"` a proposito: contarlas todas evaluaba la RLS en cada
 * aviso sin leer del negocio, en cada carga de pagina. Ordenado por fecha usa el
 * indice del workspace y corta en cuanto junta las que hacen falta.
 */
export async function countUnreadNotifications(): Promise<number> {
  const { supabase, workspace, recipients, muted } = await bellScope();

  let query = supabase
    .from("notifications")
    .select("id")
    .eq("workspace_id", workspace.id)
    .is("read_at", null)
    .or(recipients);
  if (muted) query = query.not("type", "in", muted);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(BELL_COUNT_CAP);

  if (error) {
    console.error("[notificaciones] no pude contar las no leidas:", error.message);
    return 0;
  }

  return Math.min(data?.length ?? 0, BELL_COUNT_CAP);
}
