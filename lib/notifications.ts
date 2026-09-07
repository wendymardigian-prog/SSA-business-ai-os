/**
 * Avisos a los administradores del workspace.
 *
 * El aviso siempre queda registrado en la base y visible en la app (la
 * pantalla de canales muestra el estado y el motivo en rojo). Ademas se manda
 * por email a los Owner/Admin si hay Resend conectado; si no lo hay, el aviso
 * en pantalla sigue siendo el canal.
 *
 * Nada de esto lanza: un aviso que falla nunca puede tumbar la operacion que
 * lo genero (recibir un mensaje, detectar una desconexion).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTransactionalEmail } from "@/lib/email/send";
import { channelAlertEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/app-url";

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
}: AdminNotification): Promise<void> {
  console.warn(`[aviso:${kind}] ${title} — ${body}`);

  const { error } = await supabase.from("analytics_events").insert({
    workspace_id: workspaceId,
    event_type: `notification.${kind}`,
    metadata: { title, body, ...metadata },
  });

  if (error) {
    console.error("[aviso] no pude registrar el aviso:", error.message);
  }

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
