/**
 * Los contactos cuyo id de WhatsApp (@lid) coincide con lo que se busco.
 *
 * El @lid vive en `contact_channels.platform_sender_id`, no en `contacts`, asi que
 * el buscador lo pide aparte y suma estos ids al filtro (`contactSearchFilter`).
 * Con el cliente del USUARIO: la RLS decide que puede ver, y se acota a los canales
 * del workspace de la sesion. Nunca lanza: si falla, la busqueda sigue sin esto.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { lidSearchPattern } from "./search";

const MAX_LID_MATCHES = 50;

export async function contactIdsByWhatsappLid(
  supabase: SupabaseClient,
  workspaceId: string,
  search: string,
): Promise<string[]> {
  const pattern = lidSearchPattern(search);
  if (!pattern) return [];
  try {
    const { data, error } = await supabase
      .from("contact_channels")
      .select("contact_id, channels!inner(workspace_id)")
      .eq("channels.workspace_id", workspaceId)
      .ilike("platform_sender_id", pattern)
      .limit(MAX_LID_MATCHES);
    if (error) {
      console.error("[buscador] no pude buscar por id de WhatsApp:", error.message);
      return [];
    }
    return [...new Set((data ?? []).map((row: { contact_id: string }) => row.contact_id))];
  } catch (err) {
    console.error("[buscador] no pude buscar por id de WhatsApp:", err instanceof Error ? err.message : err);
    return [];
  }
}
