"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { platformLabel } from "@/lib/platforms";
import { AGENT_PUBLIC_COLUMNS, channelAgentInfo, type PublicAgent } from "@/lib/agent/public";

/**
 * Encender o apagar el agente de IA en una conversacion (F31).
 *
 * Lo puede usar cualquier miembro, pero solo en conversaciones que le
 * corresponden: la conversacion se lee y se escribe con el cliente del usuario,
 * asi que la RLS aplica el scope de leads. Si no la ve, no la toca.
 *
 * Reglas:
 *   - Solo se enciende si el agente atiende ese canal (maestro). Se valida aca,
 *     no solo griseando el switch.
 *   - Encender una conversacion sin nadie asignado la deja a cargo del agente.
 *     Con una persona asignada, hay que elegir: mantener o reasignar al agente.
 *   - Queda en el audit_log con quien lo hizo.
 */

export type ConversationAgentResult =
  | { ok: true }
  | { ok: false; error: string }
  | { ok: false; needsAssignmentChoice: true; assignedName: string | null };

export async function setConversationAgent(input: {
  conversationId: string;
  enabled: boolean;
  /** Solo al encender con una persona asignada. */
  assignment?: "keep" | "reassign";
}): Promise<ConversationAgentResult> {
  if (typeof input?.conversationId !== "string" || typeof input.enabled !== "boolean") {
    return { ok: false, error: "Pedido invalido." };
  }
  if (input.assignment && input.assignment !== "keep" && input.assignment !== "reassign") {
    return { ok: false, error: "Pedido invalido." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesion vencio. Volve a entrar." };

  // Con el cliente del usuario: si el scope de leads no le deja ver la
  // conversacion, esto vuelve vacio.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, workspace_id, channel_id, assigned_to, agent_enabled")
    .eq("id", input.conversationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!conversation) return { ok: false, error: "No encontre la conversacion o no tenes acceso." };

  if (input.enabled) {
    const [{ data: agents }, { data: channel }] = await Promise.all([
      supabase.from("agents").select(AGENT_PUBLIC_COLUMNS).eq("workspace_id", conversation.workspace_id).is("deleted_at", null),
      supabase.from("channels").select("id, platform").eq("id", conversation.channel_id).maybeSingle(),
    ]);
    const info = channelAgentInfo((agents ?? []) as PublicAgent[], {
      id: conversation.channel_id,
      label: platformLabel(channel?.platform ?? ""),
    });
    if (!info.available) return { ok: false, error: info.message ?? "El agente no esta disponible en este canal." };

    if (conversation.assigned_to && !input.assignment) {
      const service = await createServiceClient();
      const { data: assignee } = await service.auth.admin.getUserById(conversation.assigned_to);
      const assignedName =
        (assignee?.user?.user_metadata?.full_name as string | undefined) ?? assignee?.user?.email ?? null;
      return { ok: false, needsAssignmentChoice: true, assignedName };
    }
  }

  const update: { agent_enabled: boolean; assigned_to?: null } = { agent_enabled: input.enabled };
  // "Asignada al agente" es: agente encendido y sin persona asignada.
  if (input.enabled && input.assignment === "reassign") update.assigned_to = null;

  const { data: updated, error } = await supabase
    .from("conversations")
    .update(update)
    .eq("id", conversation.id)
    .select("id");
  if (error || !updated?.length) {
    console.error("[conversation-agent] no pude cambiar el agente:", error?.message ?? "sin filas");
    return { ok: false, error: "No pude cambiar el agente en esta conversacion. Proba de nuevo." };
  }

  await logAudit({
    supabase,
    workspaceId: conversation.workspace_id,
    entityType: "conversation",
    entityId: conversation.id,
    action: "agent_toggled",
    changes: {
      agent_enabled: { old: conversation.agent_enabled, new: input.enabled },
      ...(update.assigned_to === null ? { assigned_to: { old: conversation.assigned_to, new: null } } : {}),
    },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/inbox");
  return { ok: true };
}
