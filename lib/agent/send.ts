import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { sendChannelMessage, type SendOutcome } from "@/lib/flow-engine/send";
import { messagePreview } from "@/lib/message-preview";

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
): Promise<{ sent: number; failure: SendOutcome["failure"] | null }> {
  let sent = 0;
  for (const part of parts) {
    const outcome = await send(supabase, ctx, part);
    const { error } = await supabase.from("messages").insert({
      conversation_id: ctx.conversationId,
      direction: "outbound",
      text: part,
      sent_by_agent_id: ctx.agentId,
      agent_run_id: ctx.runId,
      platform_message_id: outcome.platformMessageId ?? null,
      status: outcome.ok ? "sent" : "failed",
    });
    if (error) console.error("[agent-send] no pude guardar el mensaje enviado:", error.message);

    if (!outcome.ok) return { sent, failure: outcome.failure ?? null };
    sent++;

    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString(), last_message_preview: messagePreview(part) })
      .eq("id", ctx.conversationId);
  }
  return { sent, failure: null };
}
