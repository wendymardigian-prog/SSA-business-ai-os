"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { parseTeamAlertsSettings, serializeTeamAlertsSettings } from "@/lib/notifications/team-alerts-settings";

/**
 * Ajustes → General → "Avisos al equipo por WhatsApp": desde que WhatsApp del
 * negocio se les mandan los avisos a las personas que lo eligieron en Mi cuenta.
 *
 * Pide `settings.general`. Como el resto de Ajustes, escribe con el cliente de
 * servicio DESPUES del guard, filtrando por el workspace de la sesion (la
 * politica de `workspaces` sigue siendo de Admin). El canal tiene que ser un
 * WhatsApp de ESTE negocio, conectado y que pueda mandar.
 */
export async function saveTeamAlertsChannel(input: { channelId: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("settings.general");
  if (!ctx) return { ok: false, error: "No tenés permiso para cambiar esto." };
  const { workspace, user, supabase } = ctx;

  const next = parseTeamAlertsSettings({ whatsapp_channel_id: input.channelId });
  if (input.channelId && !next.whatsappChannelId) return { ok: false, error: "Ese canal no es válido." };

  const service = await createServiceClient();
  if (next.whatsappChannelId) {
    const { data: channel } = await service
      .from("channels")
      .select("id, platform, provider, is_active, evolution_instance")
      .eq("id", next.whatsappChannelId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (!channel || channel.platform !== "whatsapp" || channel.provider !== "evolution" || !channel.is_active || !channel.evolution_instance) {
      return { ok: false, error: "Ese WhatsApp no está conectado en este negocio." };
    }
  }

  const { data: before } = await service.from("workspaces").select("team_alerts_settings").eq("id", workspace.id).maybeSingle();
  const { error } = await service
    .from("workspaces")
    .update({ team_alerts_settings: serializeTeamAlertsSettings(next) })
    .eq("id", workspace.id);
  if (error) {
    console.error("[ajustes] no pude guardar el canal de avisos:", error.message);
    return { ok: false, error: "No pude guardar el cambio. Probá de nuevo." };
  }

  const previous = parseTeamAlertsSettings(before?.team_alerts_settings).whatsappChannelId;
  if (previous !== next.whatsappChannelId) {
    await logAudit({
      supabase,
      workspaceId: workspace.id,
      entityType: "workspace",
      entityId: workspace.id,
      action: "update",
      changes: { team_alerts_whatsapp_channel_id: { old: previous, new: next.whatsappChannelId } },
      metadata: { kind: "team_alerts" },
      performedBy: user.id,
    });
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/cuenta");
  return { ok: true };
}
