"use server";

import { revalidatePath } from "next/cache";
import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { canReplyChannel } from "@/lib/inbox/channel-access";
import { canChangeConversationAssignee } from "@/lib/inbox/assignee";
import { notifyConversationAssigned } from "@/lib/conversations/assignment";
import { getWorkspaceMembers } from "@/lib/workspace-members";

/**
 * El responsable de una conversacion (`conversations.assigned_to`).
 *
 * Quien puede:
 *  - con `contacts.assign` (Owner, Admin, o un rol con la clave): asignarla a
 *    cualquiera del equipo, o dejarla sin responsable;
 *  - cualquiera que pueda RESPONDER en esa cuenta: "Tomarla" si esta sin
 *    responsable (asignarsela a si mismo).
 *
 * La conversacion se lee con el cliente del usuario (si la RLS no se la deja
 * ver, no la toca) y se escribe con el de servicio: la policy de UPDATE pide
 * poder verla antes Y despues, y un Member con alcance "solo asignadas" que la
 * pasa a otra persona dejaria de verla.
 */

type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setConversationAssignee(input: { conversationId: string; userId: string | null }): Promise<Result> {
  if (typeof input?.conversationId !== "string" || !UUID.test(input.conversationId)) return { ok: false, error: "Pedido inválido." };
  if (input.userId !== null && (typeof input.userId !== "string" || !UUID.test(input.userId))) return { ok: false, error: "Pedido inválido." };

  const ctx = await getMemberAction();
  if (!ctx) return { ok: false, error: "Tu sesión venció. Volvé a entrar." };

  const { data: conversation } = await ctx.supabase
    .from("conversations")
    .select("id, workspace_id, channel_id, assigned_to")
    .eq("id", input.conversationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!conversation || conversation.workspace_id !== ctx.workspace.id) {
    return { ok: false, error: "No encontré la conversación o no tenés acceso." };
  }
  if (conversation.assigned_to === input.userId) return { ok: true };

  const allowed = canChangeConversationAssignee({
    canAssign: ctx.can("contacts.assign"),
    canReply: canReplyChannel(ctx.permissions, conversation.channel_id),
    viewerId: ctx.user.id,
    current: conversation.assigned_to,
    next: input.userId,
  });
  if (!allowed) return { ok: false, error: "Tu rol solo puede tomar conversaciones sin responsable." };

  if (input.userId) {
    const members = await getWorkspaceMembers(ctx.workspace.id);
    if (!members.some((m) => m.userId === input.userId)) return { ok: false, error: "Esa persona ya no está en el equipo." };
  }

  const service = await createServiceClient();
  const { data: updated, error } = await service
    .from("conversations")
    .update({ assigned_to: input.userId })
    .eq("id", conversation.id)
    .eq("workspace_id", ctx.workspace.id)
    .select("id");
  if (error || !updated?.length) {
    console.error("[asignacion] no pude asignar la conversacion:", error?.message ?? "sin filas");
    return { ok: false, error: "No pude cambiar el responsable. Probá de nuevo." };
  }

  await logAudit({
    supabase: service,
    workspaceId: ctx.workspace.id,
    entityType: "conversation",
    entityId: conversation.id,
    action: "assign",
    changes: { assigned_to: { old: conversation.assigned_to, new: input.userId } },
    metadata: { source: input.userId === ctx.user.id && !conversation.assigned_to ? "take" : "manual" },
    performedBy: ctx.user.id,
  });
  await notifyConversationAssigned(service, {
    workspaceId: ctx.workspace.id,
    conversationId: conversation.id,
    assigneeId: input.userId,
    actorId: ctx.user.id,
  });

  revalidatePath("/dashboard/inbox");
  return { ok: true };
}
