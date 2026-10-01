/**
 * Marcar que una conversacion necesita una persona (F10, F11).
 *
 * Es lo que pasa cuando el agente no puede interpretar lo que llego. Hace cuatro
 * cosas, en este orden, y el orden importa:
 *
 *   1. Marca la conversacion y APAGA el agente ahi mismo, en una sola escritura.
 *      Va primero: si algo de lo que sigue falla, la conversacion igual queda en
 *      manos de una persona, que es lo que importa.
 *   2. Deja el efecto en `audit_log`, con el agente como actor.
 *   3. Avisa en la campana al setter asignado (o a los Owner/Admin si no hay).
 *   4. Nada mas. **No manda nada al lead** y **no toca los borradores
 *      pendientes**: si el agente ya habia dejado uno, es trabajo hecho y
 *      alguien lo puede aprobar o descartar.
 *
 * Es distinto de `escalateToHuman`: ese pausa tambien las automatizaciones y
 * reabre la conversacion, porque lo llama un guardarrail o la herramienta del
 * agente. Aca el agente no fallo ni decidio nada: simplemente no pudo leer el
 * mensaje, y lo unico que corresponde es que lo lea una persona.
 *
 * Nunca lanza.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";

type Db = SupabaseClient<Database>;

export interface NeedsHumanArgs {
  workspaceId: string;
  conversationId: string;
  contactId: string | null;
  channelId: string | null;
  /**
   * Null cuando escala un flow o una secuencia (FA6): no hay agente de chat
   * involucrado, y `logAudit` ya acepta `performedByAgentId: null`.
   */
  agentId: string | null;
  runId: string | null;
  /** Por que, en una linea y en castellano: es lo que lee quien la toma. */
  reason: string;
}

export async function markNeedsHuman(
  supabase: Db,
  args: NeedsHumanArgs,
): Promise<{ marked: boolean; notified: boolean }> {
  try {
    const { data: before } = await supabase
      .from("conversations")
      .select("needs_human, agent_enabled, assigned_to")
      .eq("id", args.conversationId)
      .maybeSingle();

    const wasMarked = before?.needs_human === true;

    // Una sola escritura: marcar y apagar el agente van juntos. Si fueran dos,
    // entre una y otra el agente podria tomar otro turno.
    const { error } = await supabase
      .from("conversations")
      .update({
        needs_human: true,
        needs_human_reason: args.reason,
        needs_human_at: new Date().toISOString(),
        agent_enabled: false,
      })
      .eq("id", args.conversationId);

    if (error) {
      console.error("[needs-human] no pude marcar la conversacion:", error.message);
      return { marked: false, notified: false };
    }

    await logAudit({
      supabase,
      workspaceId: args.workspaceId,
      entityType: "conversation",
      entityId: args.conversationId,
      action: "needs_human",
      changes: {
        needs_human: { old: before?.needs_human ?? null, new: true },
        agent_enabled: { old: before?.agent_enabled ?? null, new: false },
      },
      metadata: {
        reason: args.reason,
        run_id: args.runId,
        contact_id: args.contactId,
        channel_id: args.channelId,
      },
      performedByAgentId: args.agentId,
    });

    // Una sola notificacion por escalado: reescalar no vuelve a avisar hasta que
    // alguien la resuelva. Si no, un lead que manda cinco notas de voz genera
    // cinco avisos por lo mismo.
    if (wasMarked) return { marked: true, notified: false };

    const { data: contact } = args.contactId
      ? await supabase
          .from("contacts")
          .select("display_name, instagram_username")
          .eq("id", args.contactId)
          .maybeSingle()
      : { data: null };

    const who =
      contact?.display_name || (contact?.instagram_username ? `@${contact.instagram_username}` : "Un contacto");

    await createNotification({
      supabase,
      workspaceId: args.workspaceId,
      type: "needs_human",
      title: `${who} mandó algo que el asistente no pudo entender`,
      body: `${args.reason}. El asistente no respondió: contestale vos.`,
      entityType: "conversation",
      entityId: args.conversationId,
      // Sin destinatario va a los Owner/Admin, que lo resuelve la RLS por rol.
      recipientId: before?.assigned_to ?? null,
      metadata: { reason: args.reason, run_id: args.runId, contact_id: args.contactId },
    });

    return { marked: true, notified: true };
  } catch (err) {
    console.error(
      "[needs-human] error inesperado marcando la conversacion:",
      err instanceof Error ? err.message : "error desconocido",
    );
    return { marked: false, notified: false };
  }
}

/**
 * Limpia la marca (F11).
 *
 * La llaman dos cosas: el boton "Ya lo vi" y `applyManualReply`, o sea responder
 * a mano. NO prende el agente de vuelta: apagarlo fue una decision del sistema y
 * volver a prenderlo es una decision de la persona.
 */
export async function clearNeedsHuman(
  supabase: Db,
  args: { workspaceId: string; conversationId: string; userId?: string | null },
): Promise<boolean> {
  try {
    const { data: before } = await supabase
      .from("conversations")
      .select("needs_human, needs_human_reason")
      .eq("id", args.conversationId)
      .maybeSingle();

    if (!before?.needs_human) return false;

    const { error } = await supabase
      .from("conversations")
      .update({ needs_human: false, needs_human_reason: null, needs_human_at: null })
      .eq("id", args.conversationId);

    if (error) {
      console.error("[needs-human] no pude limpiar la marca:", error.message);
      return false;
    }

    await logAudit({
      supabase,
      workspaceId: args.workspaceId,
      entityType: "conversation",
      entityId: args.conversationId,
      action: "needs_human_resolved",
      changes: { needs_human: { old: true, new: false } },
      metadata: { reason: before.needs_human_reason ?? null },
      performedBy: args.userId ?? null,
    });

    return true;
  } catch (err) {
    console.error(
      "[needs-human] error inesperado limpiando la marca:",
      err instanceof Error ? err.message : "error desconocido",
    );
    return false;
  }
}
