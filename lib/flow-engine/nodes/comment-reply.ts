import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import type { CommentReplyNodeData, FlowExecutionContext, PrivateReplyNodeData } from "../types";
import { interpolateVariables } from "../interpolate";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";

/**
 * Datos del comentario que disparo el flow.
 *
 * Los deja el procesador de comentarios en las variables de la sesion. Sin
 * post_id no hay a que responder, asi que los dos nodos cortan ahi.
 */
function resolveComment(context: FlowExecutionContext) {
  const commentId = context.variables?.comment_id || context.incomingMessage.sender?.id;
  const postId = context.variables?.post_id;
  return { commentId, postId };
}

async function resolveAccount(
  supabase: SupabaseClient<Database>,
  context: FlowExecutionContext
): Promise<string | undefined> {
  if (context.lateAccountId) return context.lateAccountId;
  const { data: channel } = await supabase
    .from("channels")
    .select("late_account_id")
    .eq("id", context.channelId)
    .single();
  return channel?.late_account_id ?? undefined;
}

/** Responde publicamente, debajo del comentario. */
export const commentReplyNode: NodeDefinition<CommentReplyNodeData> = {
  type: "commentReply",
  label: "Responder el comentario",
  async execute({ supabase, data, context }: NodeExecutionArgs<CommentReplyNodeData>) {
    const apiKey = await getZernioApiKey(context.workspaceId, { supabase });
    if (!apiKey) return;

    const lateAccountId = await resolveAccount(supabase, context);
    if (!lateAccountId) return;

    const { commentId, postId } = resolveComment(context);
    if (!commentId) return;
    if (!postId) {
      console.error("No post_id in context variables for commentReply node");
      return;
    }

    const text = interpolateVariables(data.text, context.variables || {});

    try {
      await createZernioClient(apiKey).comments.replyToInboxPost({
        path: { postId },
        body: { accountId: lateAccountId, message: text, commentId },
      });
    } catch (error) {
      console.error("Failed to post comment reply:", error);
    }
  },
};

/** Le manda un DM privado a quien comento, que abre la conversacion. */
export const privateReplyNode: NodeDefinition<PrivateReplyNodeData> = {
  type: "privateReply",
  label: "Responder por privado",
  async execute({ supabase, data, context }: NodeExecutionArgs<PrivateReplyNodeData>) {
    const apiKey = await getZernioApiKey(context.workspaceId, { supabase });
    if (!apiKey) return;

    const lateAccountId = await resolveAccount(supabase, context);
    if (!lateAccountId) return;

    const { commentId, postId } = resolveComment(context);
    if (!commentId) return;
    if (!postId) {
      console.error("No post_id in context variables for privateReply node");
      return;
    }

    const text = interpolateVariables(data.text, context.variables || {});

    try {
      await createZernioClient(apiKey).comments.sendPrivateReplyToComment({
        path: { postId, commentId },
        body: { accountId: lateAccountId, message: text },
      });

      await supabase.from("messages").insert({
        conversation_id: context.conversationId,
        direction: "outbound",
        text,
        attachments: data.imageUrl ? [{ type: "image", url: data.imageUrl }] : null,
        sent_by_flow_id: context.flowId,
        status: "sent",
      });
    } catch (error) {
      console.error("Failed to send private reply:", error);
      await supabase.from("messages").insert({
        conversation_id: context.conversationId,
        direction: "outbound",
        text,
        sent_by_flow_id: context.flowId,
        status: "failed",
      });
    }
  },
};
