import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { FlowExecutionContext, SendMessageNodeData } from "../types";
import { adaptMessage } from "../platform-adapter";
import { interpolateVariables } from "../interpolate";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";

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
    const apiKey = await getZernioApiKey(context.workspaceId, { supabase });
    if (!apiKey) return;

    const zernio = createZernioClient(apiKey);

    let lateAccountId = context.lateAccountId;
    if (!lateAccountId) {
      const { data: channel } = await supabase
        .from("channels")
        .select("late_account_id, platform")
        .eq("id", context.channelId)
        .single();

      if (!channel) return;
      lateAccountId = channel.late_account_id;
      if (!context.platform) {
        context.platform = channel.platform as FlowExecutionContext["platform"];
      }
    }

    let lateConversationId = context.lateConversationId;
    if (!lateConversationId) {
      const { data: conversation } = await supabase
        .from("conversations")
        .select("late_conversation_id")
        .eq("id", context.conversationId)
        .single();

      if (!conversation?.late_conversation_id) {
        // Los flows disparados por un comentario todavia no tienen conversacion
        // de DM. Instagram permite exactamente una respuesta privada por
        // comentario, asi que el primer mensaje sale por ahi en vez de perderse:
        // la gente arma esos flows con un Send Message comun, no con el nodo
        // Private Reply.
        if (context.variables?.comment_id && context.variables?.post_id && lateAccountId) {
          await sendFirstMessageAsPrivateReply(supabase, zernio, data, context, lateAccountId);
          return;
        }
        console.error("No late_conversation_id found for conversation:", context.conversationId);
        return;
      }
      lateConversationId = conversation.late_conversation_id;
    }

    for (const msg of data.messages) {
      const adapted = adaptMessage(msg, context.platform!);
      const text = interpolateVariables(adapted.text, context.variables || {});

      try {
        // El multimedia no depende de la plataforma, asi que se lee del mensaje
        // crudo. mediaUrl + mediaType reemplazan al viejo imageUrl.
        const rawMsg = msg as { mediaUrl?: string; mediaType?: string; imageUrl?: string };
        const mediaUrl = rawMsg.mediaUrl || rawMsg.imageUrl;
        const mediaType = rawMsg.mediaType || (rawMsg.imageUrl ? "image" : undefined);

        const attachments = mediaUrl ? [{ type: mediaType || "image", url: mediaUrl }] : undefined;

        const body: Record<string, unknown> = { accountId: lateAccountId, message: text };
        if (mediaUrl) {
          body.attachmentUrl = mediaUrl;
          body.attachmentType = mediaType || "image";
        }
        if (adapted.buttons?.length) body.buttons = adapted.buttons;
        if (adapted.quickReplies?.length) body.quickReplies = adapted.quickReplies;
        if (adapted.template) body.template = adapted.template;
        if (adapted.replyMarkup) body.replyMarkup = adapted.replyMarkup;

        const response = await zernio.messages.sendInboxMessage({
          path: { conversationId: lateConversationId },
          body: body as Parameters<typeof zernio.messages.sendInboxMessage>[0]["body"],
        });

        await supabase.from("messages").insert({
          conversation_id: context.conversationId,
          direction: "outbound",
          text,
          attachments: attachments || null,
          sent_by_flow_id: context.flowId,
          sent_by_node_id: null,
          platform_message_id: response.data?.data?.messageId || null,
          status: "sent",
        });

        await supabase.from("analytics_events").insert({
          workspace_id: context.workspaceId,
          flow_id: context.flowId,
          contact_id: context.contactId,
          event_type: "message_sent",
        });
      } catch (error) {
        console.error("Failed to send message:", error);
        await supabase.from("messages").insert({
          conversation_id: context.conversationId,
          direction: "outbound",
          text,
          sent_by_flow_id: context.flowId,
          status: "failed",
        });

        await supabase.from("analytics_events").insert({
          workspace_id: context.workspaceId,
          flow_id: context.flowId,
          contact_id: context.contactId,
          event_type: "message_failed",
          metadata: { error: error instanceof Error ? error.message : "Unknown error" },
        });
      }

      if (data.messages.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  },
};

async function sendFirstMessageAsPrivateReply(
  supabase: SupabaseClient<Database>,
  zernio: ReturnType<typeof createZernioClient>,
  data: SendMessageNodeData,
  context: FlowExecutionContext,
  lateAccountId: string
) {
  const first = data.messages[0];
  if (!first) return;

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
