/**
 * Por donde se le puede avisar al equipo de un negocio (Mi cuenta → Notificaciones).
 *
 * SOLO servidor: recibe el cliente de servicio, y el workspace lo pone quien
 * llama (siempre el de la sesion, o el del aviso en el job). Nunca lanza: si
 * no se puede leer, el canal se da por no disponible.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { parseTeamAlertsSettings } from "./team-alerts-settings";

type Db = SupabaseClient<Database>;

export interface TeamAlertsChannel {
  id: string;
  name: string;
  instance: string;
}

/** El WhatsApp elegido para avisar al equipo, si sigue conectado y puede mandar. */
export async function loadTeamAlertsChannel(service: Db, workspaceId: string): Promise<TeamAlertsChannel | null> {
  try {
    const { data: ws } = await service.from("workspaces").select("team_alerts_settings").eq("id", workspaceId).maybeSingle();
    const { whatsappChannelId } = parseTeamAlertsSettings(ws?.team_alerts_settings);
    if (!whatsappChannelId) return null;
    const { data: channel } = await service
      .from("channels")
      .select("id, display_name, username, platform, provider, is_active, evolution_instance")
      .eq("id", whatsappChannelId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!channel || channel.platform !== "whatsapp" || channel.provider !== "evolution" || !channel.is_active || !channel.evolution_instance) {
      return null;
    }
    return { id: channel.id, name: channel.display_name?.trim() || channel.username?.trim() || "WhatsApp", instance: channel.evolution_instance };
  } catch (err) {
    console.error("[avisos] no pude leer el canal de avisos:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Si el negocio tiene Resend conectado (sin eso no sale ningun email). */
export async function emailConfigured(service: Db, workspaceId: string): Promise<boolean> {
  try {
    const { data } = await service
      .from("integration_configs")
      .select("is_active")
      .eq("workspace_id", workspaceId)
      .eq("type", "email_provider")
      .eq("provider", "resend")
      .maybeSingle();
    return Boolean(data?.is_active);
  } catch {
    return false;
  }
}
