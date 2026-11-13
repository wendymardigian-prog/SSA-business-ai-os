/**
 * «¿Alguien del equipo ya le escribió por WhatsApp?» — para la opción «No mandar si ya le escribiste» de un paso de
 * WhatsApp (por ejemplo, el WhatsApp de bienvenida después de agendar: si la dueña ya le escribió desde el teléfono, el
 * automático sobra).
 *
 * Cuenta solo lo que escribió una PERSONA del equipo, en cualquier conversación de WhatsApp del contacto:
 *   - `external`: salió desde el teléfono (la app de WhatsApp), fuera del sistema.
 *   - `user`: salió desde la bandeja, escrito por alguien del equipo.
 * No cuentan las automatizaciones (`flow`), las difusiones (`broadcast`) ni el agente de IA (`agent`).
 *
 * «Desde» es el arranque de la ejecución: lo que se habló antes de agendar no frena el mensaje.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export const TEAM_ORIGINS = ["external", "user"] as const;

/** true si alguien del equipo le escribió por WhatsApp desde `since`; null si no se pudo mirar. */
export async function teamWroteOnWhatsAppSince(
  supabase: SupabaseClient<Database>,
  args: { workspaceId: string; contactId: string; since: string }
): Promise<boolean | null> {
  const { data: conversations, error: convError } = await supabase
    .from("conversations")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("contact_id", args.contactId)
    .eq("platform", "whatsapp");
  if (convError) return null;
  const ids = (conversations ?? []).map((c) => c.id);
  if (ids.length === 0) return false;

  const { data: messages, error } = await supabase
    .from("messages")
    .select("id")
    .in("conversation_id", ids)
    .eq("direction", "outbound")
    .in("origin", [...TEAM_ORIGINS])
    .gte("created_at", args.since)
    .limit(1);
  if (error) return null;
  return (messages ?? []).length > 0;
}

/** Cuándo arrancó la ejecución, o null si no se sabe (el simulador no tiene sesión). */
export async function sessionStartedAt(supabase: SupabaseClient<Database>, sessionId: string | undefined): Promise<string | null> {
  if (!sessionId) return null;
  const { data } = await supabase.from("flow_sessions").select("created_at").eq("id", sessionId).maybeSingle();
  return data?.created_at ?? null;
}
