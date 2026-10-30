/**
 * Avisos a los administradores del workspace.
 *
 * El aviso va al centro de notificaciones (tabla `notifications`, F18): la
 * campana lo muestra en el momento por Realtime y queda con estado de leido.
 * El email y el WhatsApp los manda el job de entrega segun lo que eligio cada
 * persona (Mi cuenta → Notificaciones); por defecto, Owner/Admin lo reciben por email.
 *
 * Hasta el Bloque 3 esto escribia en analytics_events, que era el sustituto
 * declarado mientras no existia la tabla. El unico cambio fue el destino: la
 * firma, el contrato y el email siguen igual, y por eso el cron de canales no
 * se toco. Eso es lo que hace que el aviso de "canal desconectado" quede
 * canal-agnostico: cualquier canal que reporte una caida usa esta funcion.
 *
 * Nada de esto lanza: un aviso que falla nunca puede tumbar la operacion que
 * lo genero (recibir un mensaje, detectar una desconexion).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createNotificationOnce } from "@/lib/notifications/create";

export type NotificationKind =
  | "channel_disconnected"
  | "channel_reconnected"
  | "channel_error";

export interface AdminNotification {
  supabase: SupabaseClient;
  workspaceId: string;
  kind: NotificationKind;
  /** Titulo corto, en lenguaje de la usuaria. */
  title: string;
  /** Que paso y que hacer al respecto. */
  body: string;
  /** Datos del evento. No meter aca API keys ni datos personales. */
  metadata?: Record<string, unknown>;
  /** El canal (u otra entidad) al que apunta el aviso, para el deep-link. */
  entityId?: string | null;
}

/**
 * Registra el aviso y lo deja disponible para los admins.
 * No lanza: un aviso que falla nunca tiene que tumbar la operacion que lo genero.
 */
export async function notifyWorkspaceAdmins({
  supabase,
  workspaceId,
  kind,
  title,
  body,
  metadata = {},
  entityId = null,
}: AdminNotification): Promise<void> {
  console.warn(`[aviso:${kind}] ${title} — ${body}`);

  // recipientId queda sin definir: es un aviso para los Owner/Admin, y quien
  // decide quien lo ve es la RLS (can_see_notification), no este codigo.
  //
  // createNotificationOnce y no createNotification: un canal que rebota
  // generaria un aviso por cada chequeo del cron y la campana dejaria de
  // servir. Si ya hay uno sin leer del mismo canal en la ultima hora, alcanza.
  await createNotificationOnce({
    supabase: supabase as SupabaseClient<Database>,
    workspaceId,
    type: kind,
    title,
    body,
    entityType: "channel",
    entityId,
    metadata,
    withinMinutes: 60,
  });

  // El email (y el WhatsApp) ya no salen de aca: los manda el job de entrega a quien
  // lo eligio en Mi cuenta → Notificaciones (`lib/notifications/deliver.ts`). Por
  // defecto, el aviso de canal desconectado le llega por email a Owner/Admin, igual que antes.
}
