import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext, SendMessageNodeData } from "../types";
import { adaptMessage } from "../platform-adapter";
import { interpolateVariables } from "../interpolate";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { sendChannelMessage, recordSend } from "../send";

/**
 * Manda uno o varios mensajes por el canal de la conversacion.
 *
 * El contenido se adapta al formato de cada plataforma con el platform-adapter
 * (carruseles que no existen en WhatsApp bajan a texto, botones que Telegram
 * expresa distinto, etc.) antes de interpolar las variables.
 */
export const sendMessageNode: NodeDefinition<SendMessageNodeData> = {
  type: "sendMessage",
  label: "Enviar mensaje",
  async execute({ supabase, data, context }: NodeExecutionArgs<SendMessageNodeData>) {
    // La plataforma hace falta para adaptar el formato del mensaje. Si no vino
    // en el contexto, se resuelve una vez y se reusa para todos los mensajes.
    if (!context.platform) {
      const { data: channel } = await supabase
        .from("channels")
        .select("platform")
        .eq("id", context.channelId)
        .single();
      if (!channel) return;
      context.platform = channel.platform as FlowExecutionContext["platform"];
    }

    // Los flows disparados por un comentario todavia no tienen conversacion de
    // DM abierta. Instagram permite exactamente una respuesta privada por
    // comentario, asi que el primer mensaje sale por ahi en vez de perderse: la
    // gente arma esos flows con un Send Message comun, no con Private Reply.
    if (await needsCommentFallback(supabase, context)) {
      await sendFirstMessageAsPrivateReply(supabase, data, context);
      return;
    }

    for (const msg of data.messages) {
      const adapted = adaptMessage(msg, context.platform!);
      const text = interpolateVariables(adapted.text, context.variables || {});

      // El multimedia no depende de la plataforma, asi que se lee del mensaje
      // crudo. mediaUrl + mediaType reemplazan al viejo imageUrl.
      const rawMsg = msg as { mediaUrl?: string; mediaType?: string; imageUrl?: string };
      const mediaUrl = rawMsg.mediaUrl || rawMsg.imageUrl;
      const mediaType = rawMsg.mediaType || (rawMsg.imageUrl ? "image" : undefined);

      const outcome = await sendChannelMessage(supabase, context, {
        text,
        mediaUrl,
        mediaType,
        buttons: adapted.buttons,
        quickReplies: adapted.quickReplies,
        template: adapted.template,
        replyMarkup: adapted.replyMarkup,
      });

      await recordSend(
        supabase,
        context,
        // Un envio rechazado guarda el motivo en lugar del texto que no salio:
        // es lo que va a leer el operador en la conversacion.
        outcome.ok ? text : outcome.failure?.message ?? text,
        outcome,
        mediaUrl ? [{ type: mediaType || "image", url: mediaUrl }] : null
      );

      // Si el canal esta frenado por el tope de la hora, mandar los que siguen
      // solo suma rechazos: se corta el nodo aca.
      if (!outcome.ok && outcome.failure?.kind === "rate_limited") return;

      if (data.messages.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  },
};

/**
 * True cuando el flow nacio de un comentario y todavia no hay DM abierto.
 *
 * Solo aplica a los canales de Zernio: en WhatsApp no existen los comentarios.
 */
async function needsCommentFallback(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext
): Promise<boolean> {
  if (!context.variables?.comment_id || !context.variables?.post_id) return false;
  if (context.lateConversationId) return false;

  const { data: conversation } = await supabase
    .from("conversations")
    .select("late_conversation_id")
    .eq("id", context.conversationId)
    .single();

  return !conversation?.late_conversation_id;
}

async function sendFirstMessageAsPrivateReply(
  supabase: SupabaseClient<Database>,
  data: SendMessageNodeData,
  context: FlowExecutionContext
) {
  const first = data.messages[0];
  if (!first) return;

  const apiKey = await getZernioApiKey(context.workspaceId, { supabase });
  if (!apiKey) return;

  let lateAccountId = context.lateAccountId;
  if (!lateAccountId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("late_account_id")
      .eq("id", context.channelId)
      .single();
    if (!channel?.late_account_id) return;
    lateAccountId = channel.late_account_id;
  }

  const zernio = createZernioClient(apiKey);

  const text = interpolateVariables(
    adaptMessage(first, context.platform ?? "instagram").text,
    context.variables || {}
  );

  try {
    await zernio.comments.sendPrivateReplyToComment({
      path: {
        postId: String(context.variables!.post_id),
        commentId: String(context.variables!.comment_id),
      },
      body: { accountId: lateAccountId, message: text },
    });

    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "sent",
    });

    await supabase.from("analytics_events").insert({
      workspace_id: context.workspaceId,
      flow_id: context.flowId,
      contact_id: context.contactId,
      event_type: "message_sent",
    });
  } catch (error) {
    console.error("Failed to send comment-context message as private reply:", error);
    await supabase.from("messages").insert({
      conversation_id: context.conversationId,
      direction: "outbound",
      text,
      sent_by_flow_id: context.flowId,
      status: "failed",
    });
    return;
  }

  if (data.messages.length > 1) {
    console.warn(
      "Comment flow Send Message node had multiple messages; only the first was sent (one private reply per comment)."
    );
  }
}
