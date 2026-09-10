/**
 * Avisos a los administradores del workspace.
 *
 * El aviso va al centro de notificaciones (tabla `notifications`, F18): la
 * campana lo muestra en el momento por Realtime y queda con estado de leido.
 * Ademas se manda por email a los Owner/Admin si hay Resend conectado.
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
import { sendTransactionalEmail } from "@/lib/email/send";
import { channelAlertEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/app-url";
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

  // Email a los admins. Best-effort en dos sentidos: si Resend no esta
  // conectado no pasa nada (el aviso ya quedo en pantalla), y si algo falla se
  // loguea sin cortar.
  try {
    const emails = await workspaceAdminEmails(supabase, workspaceId);
    if (emails.length === 0) return;

    const content = channelAlertEmail({ title, body, appUrl: appUrl() });

    for (const email of emails) {
      await sendTransactionalEmail({
        workspaceId,
        to: email,
        subject: content.subject,
        html: content.html,
        kind: kind,
      });
    }
  } catch (err) {
    console.error(
      "[aviso] no pude mandar el aviso por email:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Los emails de los Owner y Admin del workspace. */
export async function workspaceAdminEmails(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string[]> {
  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .in("role", ["owner", "admin"]);

  const emails: string[] = [];
  for (const member of members ?? []) {
    const { data } = await supabase.auth.admin.getUserById(member.user_id);
    if (data?.user?.email) emails.push(data.user.email);
  }
  return emails;
}
