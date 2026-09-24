"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { platformLabel } from "@/lib/platforms";
import { fromAgentMode, type ConversationAgentMode } from "@/lib/agent/config";
import { AGENT_PUBLIC_COLUMNS, channelAgentInfo, type PublicAgent } from "@/lib/agent/public";

/**
 * El agente de IA en una conversacion: heredar del canal, forzado prendido o
 * forzado apagado (F31, interruptor de tres estados de la 00066).
 *
 * Lo puede usar cualquier miembro, pero solo en conversaciones que le
 * corresponden: la conversacion se lee y se escribe con el cliente del usuario,
 * asi que la RLS aplica el scope de leads. Si no la ve, no la toca.
 *
 * Reglas:
 *   - "Prendido" solo se puede elegir si el agente atiende ese canal (maestro).
 *     Se valida aca, no solo griseando el boton. "Heredar" y "Apagado" siempre.
 *   - Si el resultado efectivo es "el agente atiende" y hay una persona
 *     asignada, hay que elegir: mantener la asignacion o reasignar al agente.
 *   - Queda en el audit_log con quien lo hizo y de que estado a cual.
 */

const MODES: ConversationAgentMode[] = ["inherit", "on", "off"];

export type ConversationAgentResult =
  | { ok: true }
  | { ok: false; error: string }
  | { ok: false; needsAssignmentChoice: true; assignedName: string | null };

export async function setConversationAgent(input: {
  conversationId: string;
  mode: ConversationAgentMode;
  /** Solo cuando el resultado es "atendida por el agente" y hay una persona asignada. */
  assignment?: "keep" | "reassign";
}): Promise<ConversationAgentResult> {
  if (typeof input?.conversationId !== "string" || !MODES.includes(input.mode)) {
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

  const next = fromAgentMode(input.mode);
  if (next === conversation.agent_enabled) return { ok: true };

  let effectiveOn = false;
  if (input.mode !== "off") {
    const [{ data: agents }, { data: channel }] = await Promise.all([
      supabase.from("agents").select(AGENT_PUBLIC_COLUMNS).eq("workspace_id", conversation.workspace_id).is("deleted_at", null),
      supabase.from("channels").select("id, platform").eq("id", conversation.channel_id).maybeSingle(),
    ]);
    const info = channelAgentInfo((agents ?? []) as PublicAgent[], {
      id: conversation.channel_id,
      label: platformLabel(channel?.platform ?? ""),
    });
    if (input.mode === "on" && !info.available) {
      return { ok: false, error: info.message ?? "El agente no esta disponible en este canal." };
    }
    effectiveOn = info.available;

    if (effectiveOn && conversation.assigned_to && !input.assignment) {
      const service = await createServiceClient();
      const { data: assignee } = await service.auth.admin.getUserById(conversation.assigned_to);
      const assignedName =
        (assignee?.user?.user_metadata?.full_name as string | undefined) ?? assignee?.user?.email ?? null;
      return { ok: false, needsAssignmentChoice: true, assignedName };
    }
  }

  const update: { agent_enabled: boolean | null; assigned_to?: null } = { agent_enabled: next };
  // "Asignada al agente" es: el agente la atiende y no hay persona asignada.
  if (effectiveOn && input.assignment === "reassign") update.assigned_to = null;

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
      agent_enabled: { old: conversation.agent_enabled ?? null, new: next },
      ...(update.assigned_to === null ? { assigned_to: { old: conversation.assigned_to, new: null } } : {}),
    },
    metadata: { mode: input.mode },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/inbox");
  return { ok: true };
}
