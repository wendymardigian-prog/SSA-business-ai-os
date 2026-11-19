"use server";

/**
 * ¿El número de esta conversación (o de este grupo) ya gastó su cupo? Para el aviso del cuadro de escribir.
 *
 * Solo lee: no frena ningún envío. La conversación o el grupo se buscan con el cliente de la persona (RLS: si no lo ve,
 * no hay aviso); el cupo se cuenta con el de servicio porque `send_lane_counts` es solo del servidor.
 */
import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { loadManualQuotaWarning } from "@/lib/send-queue/automation/manual-quota-load";
import type { ManualQuotaWarning } from "@/lib/send-queue/automation/manual-quota";

const UUID = /^[0-9a-f-]{36}$/i;

export async function getManualQuotaWarningAction(conversationId: string): Promise<ManualQuotaWarning | null> {
  if (typeof conversationId !== "string" || !UUID.test(conversationId)) return null;
  const ctx = await getMemberAction();
  if (!ctx) return null;

  const { data: conv } = await ctx.supabase.from("conversations").select("channel_id, workspace_id").eq("id", conversationId).maybeSingle();
  if (!conv?.channel_id || conv.workspace_id !== ctx.workspace.id) return null;

  const service = await createServiceClient();
  return loadManualQuotaWarning(service, { workspaceId: ctx.workspace.id, channelId: conv.channel_id });
}

export async function getGroupQuotaWarningAction(groupId: string): Promise<ManualQuotaWarning | null> {
  if (typeof groupId !== "string" || !UUID.test(groupId)) return null;
  const ctx = await getMemberAction();
  if (!ctx) return null;

  const { data: group } = await ctx.supabase.from("whatsapp_groups").select("channel_id, workspace_id, left_at").eq("id", groupId).maybeSingle();
  if (!group?.channel_id || group.left_at || group.workspace_id !== ctx.workspace.id) return null;

  const service = await createServiceClient();
  return loadManualQuotaWarning(service, { workspaceId: ctx.workspace.id, channelId: group.channel_id });
}
