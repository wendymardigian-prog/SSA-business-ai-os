/**
 * Asignar una conversacion: lo que comparten la accion de la bandeja, la regla
 * automatica (00255) y el agente.
 *
 * Dos reglas de siempre:
 *  - **Nunca lanza.** Asignar es un efecto de un webhook o de un clic: si el
 *    aviso o el historial fallan, la conversacion igual queda guardada.
 *  - **El aviso nunca va a quien hizo el cambio** (tampoco a quien se la asigna
 *    a si mismo).
 *
 * Solo de servidor: recibe el cliente de servicio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { auditAsSystem } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";

type Db = SupabaseClient<Database>;

/** Avisa a la persona que ahora tiene la conversacion. */
export async function notifyConversationAssigned(
  service: Db,
  args: { workspaceId: string; conversationId: string; assigneeId: string | null; actorId: string | null; reason?: string },
): Promise<void> {
  if (!args.assigneeId || args.assigneeId === args.actorId) return;
  try {
    const { data } = await service
      .from("conversations")
      .select("platform, contacts(display_name)")
      .eq("id", args.conversationId)
      .maybeSingle();
    const row = data as { platform?: string | null; contacts?: { display_name?: string | null } | null } | null;
    const name = row?.contacts?.display_name?.trim() || "un contacto";
    await createNotification({
      supabase: service,
      workspaceId: args.workspaceId,
      type: "conversation_assigned",
      title: `Te asignaron la conversación con ${name}`,
      body: args.reason,
      entityType: "conversation",
      entityId: args.conversationId,
      recipientId: args.assigneeId,
      metadata: { platform: row?.platform ?? null },
    });
  } catch (err) {
    console.error("[asignacion] no pude avisar:", err instanceof Error ? err.message : String(err));
  }
}

interface RuleResult {
  status?: string;
  assigned_to?: string | null;
  rule_id?: string | null;
  rule_name?: string | null;
  contact_id?: string | null;
  setter_changed?: boolean;
  setter_old?: string | null;
  /** "rule", "known" (00256) o "customer" (00268): el chat de un conocido o un cliente va a la persona de esa cuenta. */
  source?: string | null;
}

/**
 * Aplica las reglas de asignacion a una conversacion RECIEN creada. La RPC
 * hace todo en una transaccion; aca queda el historial y el aviso.
 */
export async function applyConversationRules(service: Db, args: { workspaceId: string; conversationId: string }): Promise<string | null> {
  try {
    const { data, error } = await service.rpc("assign_new_conversation", { p_conversation_id: args.conversationId });
    if (error) {
      console.error("[asignacion] no pude aplicar las reglas:", error.message);
      return null;
    }
    const result = (data ?? {}) as RuleResult;
    if (result.status !== "assigned" || !result.assigned_to) return null;

    const label =
      result.source === "known"
        ? "Conocido"
        : result.source === "customer"
          ? "Cliente"
          : result.rule_name?.trim()
          ? `Regla «${result.rule_name.trim()}»`
          : "Regla de asignación";
    await auditAsSystem({
      supabase: service,
      workspaceId: args.workspaceId,
      entityType: "conversation",
      entityId: args.conversationId,
      action: "assign",
      changes: { assigned_to: { old: null, new: result.assigned_to } },
      metadata: {
        rule_id: result.rule_id ?? null,
        source: result.source === "known" || result.source === "customer" ? result.source : "conversation_rule",
      },
      label,
    });
    if (result.setter_changed && result.contact_id) {
      await auditAsSystem({
        supabase: service,
        workspaceId: args.workspaceId,
        entityType: "contact",
        entityId: result.contact_id,
        action: "assign",
        changes: { setter_id: { old: result.setter_old ?? null, new: result.assigned_to } },
        metadata: { rule_id: result.rule_id ?? null, source: "conversation_rule", conversation_id: args.conversationId },
        label,
      });
    }
    await notifyConversationAssigned(service, {
      workspaceId: args.workspaceId,
      conversationId: args.conversationId,
      assigneeId: result.assigned_to,
      actorId: null,
      reason:
        result.source === "known"
          ? "Es un conocido: te llega a vos por la cuenta por la que escribe."
          : result.source === "customer"
            ? "Es un cliente: te llega a vos por la cuenta por la que escribe."
            : `${label}.`,
    });
    return result.assigned_to;
  } catch (err) {
    console.error("[asignacion] no pude aplicar las reglas:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
