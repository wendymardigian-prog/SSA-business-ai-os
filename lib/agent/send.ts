import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { sendChannelMessage, type SendOutcome } from "@/lib/flow-engine/send";
import { messagePreview } from "@/lib/message-preview";
import { outboundMessageRow } from "@/lib/messages/outbound";

/**
 * Envio de la respuesta del agente.
 *
 * Usa la misma puerta de salida que los flows (sendChannelMessage: tope de
 * envios de Instagram, WhatsApp listo, errores traducidos), y guarda cada parte
 * en messages con la autoria del agente y el run que la genero. Las partes van
 * en orden y se frena en la primera que falla: mandar la tercera sin la
 * primera no tiene sentido.
 */

type Db = SupabaseClient<Database>;

export interface AgentSendContext {
  workspaceId: string;
  channelId: string;
  contactId: string;
  conversationId: string;
  lateConversationId?: string | null;
  agentId: string;
  runId: string | null;
  /**
   * Quien aprobo, cuando sale un borrador (Bloque 2c). El mensaje queda con
   * las dos autorias: es del agente Y de quien lo aprobo. NO es una respuesta
   * manual: no pasa por applyManualReply y lastHumanReplyAt lo ignora.
   */
  sentByUserId?: string | null;
}

export type SendFn = (supabase: Db, ctx: AgentSendContext, text: string) => Promise<SendOutcome>;

export const defaultSend: SendFn = (supabase, ctx, text) =>
  sendChannelMessage(
    supabase,
    {
      workspaceId: ctx.workspaceId,
      channelId: ctx.channelId,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      lateConversationId: ctx.lateConversationId ?? undefined,
      flowId: null,
    },
    { text },
  );

export async function sendAgentParts(
  supabase: Db,
  ctx: AgentSendContext,
  parts: string[],
  send: SendFn = defaultSend,
): Promise<{ sent: number; failure: SendOutcome["failure"] | null; firstMessageId: string | null }> {
  let sent = 0;
  let firstMessageId: string | null = null;
  for (const part of parts) {
    const outcome = await send(supabase, ctx, part);
    const { data: stored, error } = await supabase.from("messages").insert(
      outboundMessageRow({
        conversationId: ctx.conversationId,
        origin: "agent",
        text: part,
        sentByAgentId: ctx.agentId,
        sentByUserId: ctx.sentByUserId ?? null,
        agentRunId: ctx.runId,
        platformMessageId: outcome.platformMessageId ?? null,
        status: outcome.ok ? "sent" : "failed",
      }),
    ).select("id").single();
    if (error) console.error("[agent-send] no pude guardar el mensaje enviado:", error.message);
    if (outcome.ok && !firstMessageId) firstMessageId = stored?.id ?? null;

    if (!outcome.ok) return { sent, failure: outcome.failure ?? null, firstMessageId };
    sent++;

    // La respuesta salio de verdad: queda el instante en el run (00070). Se
    // escribe en los dos modos, asi el tiempo de respuesta se compara con el
    // mismo numero en envio directo y en borrador.
    if (sent === 1 && ctx.runId) {
      const { error: runError } = await supabase
        .from("agent_runs")
        .update({ responded_at: new Date().toISOString() })
        .eq("id", ctx.runId)
        .is("responded_at", null);
      if (runError) console.error("[agent-send] no pude anotar cuando salio la respuesta:", runError.message);
    }

    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString(), last_message_preview: messagePreview(part) })
      .eq("id", ctx.conversationId);
  }
  return { sent, failure: null, firstMessageId };
}
