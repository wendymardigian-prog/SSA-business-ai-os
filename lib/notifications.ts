/**
 * Avisos a los administradores del workspace.
 *
 * En el Bloque 1 el aviso queda registrado en la base y visible en la app (la
 * pantalla de canales muestra el estado y el motivo en rojo). El envio por
 * email entra en el Bloque 2, cuando se conecte Resend: ese es el unico cambio
 * que hay que hacer aca, porque quienes avisan ya llaman a esta funcion.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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

  // BLOQUE 2: con Resend configurado, buscar los owner/admin del workspace y
  // mandarles este mismo title/body por email.
}

/** Los emails de los Owner y Admin del workspace. Lo va a usar el Bloque 2. */
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
