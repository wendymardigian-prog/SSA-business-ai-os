import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { outboundMessageRow } from "@/lib/messages/outbound";
import type { CommentReplyNodeData, FlowExecutionContext, PrivateReplyNodeData } from "../types";
import { interpolateDeep, interpolateVariables } from "../interpolate";
import { sendablePrivateReplyButtons } from "../private-reply";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { describeSendError } from "@/lib/instagram-errors";
import { sentContentContext } from "@/lib/attribution/content-variables";

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
  needsContact: true,
  type: "commentReply",
  label: "Responder el comentario",
  async execute({ supabase, data, context }: NodeExecutionArgs<CommentReplyNodeData>) {
    const apiKey = await getZernioApiKey(context.workspaceId, { supabase });
    if (!apiKey) {
      context.noteStep?.({ status: "skipped", reason: "Zernio no está conectado." });
      return;
    }

    const lateAccountId = await resolveAccount(supabase, context);
    if (!lateAccountId) {
      context.noteStep?.({ status: "skipped", reason: "No se encontró la cuenta del canal." });
      return;
    }

    const { commentId, postId } = resolveComment(context);
    if (!commentId) {
      context.noteStep?.({ status: "skipped", reason: "Esta ejecución no arrancó por un comentario." });
      return;
    }
    if (!postId) {
      console.error("No post_id in context variables for commentReply node");
      context.noteStep?.({ status: "skipped", reason: "No se encontró la publicación del comentario." });
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
      context.noteStep?.({ status: "failed", reason: "No se pudo responder el comentario." });
    }
  },
};

/**
 * Le manda un DM privado a quien comento, que abre la conversacion.
 *
 * Sale siempre como respuesta al comentario, aunque la persona ya tenga un chat: es lo unico que Instagram deja mandar
 * sin que haya escrito en las ultimas 24 horas. Por eso «Enviar mensaje» no alcanza para un comentario de alguien
 * conocido, y por eso los botones viven aca (su respaldo por respuesta privada manda solo el texto).
 */
export const privateReplyNode: NodeDefinition<PrivateReplyNodeData> = {
  needsContact: true,
  type: "privateReply",
  label: "Responder por privado",
  aliases: [{ nodeType: "action", actionType: "privateReply" }],
  async execute({ supabase, data, context, node }: NodeExecutionArgs<PrivateReplyNodeData>) {
    const apiKey = await getZernioApiKey(context.workspaceId, { supabase });
    if (!apiKey) {
      context.noteStep?.({ status: "skipped", reason: "Zernio no está conectado." });
      return;
    }

    const lateAccountId = await resolveAccount(supabase, context);
    if (!lateAccountId) {
      context.noteStep?.({ status: "skipped", reason: "No se encontró la cuenta del canal." });
      return;
    }

    const { commentId, postId } = resolveComment(context);
    if (!commentId) {
      context.noteStep?.({ status: "skipped", reason: "Esta ejecución no arrancó por un comentario." });
      return;
    }
    if (!postId) {
      console.error("No post_id in context variables for privateReply node");
      context.noteStep?.({ status: "skipped", reason: "No se encontró la publicación del comentario." });
      return;
    }

    const text = interpolateVariables(data.text, context.variables || {});
    const buttons = sendablePrivateReplyButtons(interpolateDeep(data.buttons ?? [], context.variables || {}));

    try {
      await createZernioClient(apiKey).comments.sendPrivateReplyToComment({
        path: { postId, commentId },
        body: { accountId: lateAccountId, message: text, ...(buttons.length > 0 ? { buttons } : {}) },
      });

      await supabase.from("messages").insert(
        outboundMessageRow({
          conversationId: context.conversationId,
          origin: "flow",
          text,
          attachments: data.imageUrl ? [{ type: "image", url: data.imageUrl }] : null,
          sentByFlowId: context.flowId ?? null,
          sentByNodeId: node.id,
          status: "sent",
          originContext: sentContentContext(context),
        }),
      );
    } catch (error) {
      console.error("Failed to send private reply:", error);
      const reason = describeSendError(error).message ?? "No se pudo mandar la respuesta por privado.";
      context.noteStep?.({ status: "failed", reason });
      // El texto queda como se quiso mandar y el motivo aparte: asi la bandeja muestra por que no salio.
      await supabase.from("messages").insert({
        ...outboundMessageRow({
          conversationId: context.conversationId,
          origin: "flow",
          text,
          sentByFlowId: context.flowId ?? null,
          sentByNodeId: node.id,
          status: "failed",
        }),
        send_error: reason,
      });
    }
  },
};
