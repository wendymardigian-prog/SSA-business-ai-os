import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { outboundMessageRow } from "@/lib/messages/outbound";
import type { CommentReplyNodeData, FlowExecutionContext, PrivateReplyNodeData } from "../types";
import { interpolateDeep, interpolateVariables } from "../interpolate";
import { sendablePrivateReplyButtons, type PrivateReplyButton } from "../private-reply";
import { deferFlowNode } from "../defer-node";
import { clearProviderRetry, nextProviderRetry, PROVIDER_RETRY_VAR, retryNote } from "../provider-retry";
import { attributeOutgoing } from "@/lib/attribution/outgoing-links";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { canAutoRetry, describeSendError } from "@/lib/instagram-errors";
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
 * Manda la respuesta privada a un comentario y deja todo anotado: el mensaje (enviado o fallido, con su motivo), el
 * paso en el historial con la clave del motivo, y, si el problema es pasajero, el paso queda para reintentar a 1, 5 y
 * 15 minutos. La usan «Responder por privado» y el respaldo de «Enviar mensaje» en un flujo de comentario.
 *
 * Devuelve `"pause"` si quedo para reintentar (el motor no sigue con el paso siguiente), o nada.
 */
export async function deliverPrivateReply(
  supabase: SupabaseClient<Database>,
  args: {
    context: FlowExecutionContext;
    nodeId: string;
    nodeType: string;
    sessionId: string;
    apiKey: string;
    lateAccountId: string;
    postId: string;
    commentId: string;
    text: string;
    buttons: PrivateReplyButton[];
    attachments?: unknown[] | null;
  },
): Promise<"pause" | void> {
  const { context, nodeId } = args;
  try {
    await createZernioClient(args.apiKey).comments.sendPrivateReplyToComment({
      path: { postId: args.postId, commentId: args.commentId },
      body: { accountId: args.lateAccountId, message: args.text, ...(args.buttons.length > 0 ? { buttons: args.buttons } : {}) },
    });
  } catch (error) {
    const failure = describeSendError(error);
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    // Sin el texto ni el comentario: la clave del motivo y el status alcanzan para seguirlo en los logs.
    console.error(`[flow-engine] Instagram rechazo la respuesta privada (${failure.kind}, status=${typeof status === "number" ? status : "?"})`);

    if (canAutoRetry(failure.kind)) {
      const retryAt = nextProviderRetry(context, nodeId);
      if (retryAt) {
        const attempt = (((context.variables as Record<string, unknown>)?.[PROVIDER_RETRY_VAR] as Record<string, number>) ?? {})[nodeId] ?? 1;
        return deferFlowNode(supabase, {
          nodeId,
          nodeType: args.nodeType,
          sessionId: args.sessionId,
          context,
          retryAt,
          reason: "provider_retry",
          message: retryNote(failure.message, attempt),
        });
      }
    }
    clearProviderRetry(context, nodeId);

    context.noteStep?.({ status: "failed", reason: failure.message, kind: failure.kind });
    // El texto queda como se quiso mandar y el motivo aparte: asi la bandeja muestra por que no salio.
    await supabase.from("messages").insert({
      ...outboundMessageRow({
        conversationId: context.conversationId,
        origin: "flow",
        text: args.text,
        attachments: (args.attachments as never) ?? null,
        sentByFlowId: context.flowId ?? null,
        sentByNodeId: nodeId,
        status: "failed",
        originContext: sentContentContext(context),
      }),
      send_error: failure.message,
    });
    return;
  }

  clearProviderRetry(context, nodeId);
  await supabase.from("messages").insert(
    outboundMessageRow({
      conversationId: context.conversationId,
      origin: "flow",
      text: args.text,
      attachments: (args.attachments as never) ?? null,
      sentByFlowId: context.flowId ?? null,
      sentByNodeId: nodeId,
      status: "sent",
      originContext: sentContentContext(context),
    }),
  );
}

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
  async execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<PrivateReplyNodeData>) {
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

    const interpolated = interpolateVariables(data.text, context.variables || {});
    const rawButtons = sendablePrivateReplyButtons(interpolateDeep(data.buttons ?? [], context.variables || {}));
    // UTM y, con «Contar clics», cada boton con su clave: el lienzo cuenta los clics por boton. Apagado, igual que antes.
    const attributed = await attributeOutgoing(
      supabase,
      {
        workspaceId: context.workspaceId,
        contactId: context.contactId,
        flowId: context.flowId,
        platform: "instagram",
        variables: context.variables,
        nodeId: node.id,
        sessionId,
      },
      data.attribution,
      { text: interpolated, buttons: rawButtons as Array<PrivateReplyButton & Record<string, unknown>> },
    );
    const buttons = sendablePrivateReplyButtons(attributed.buttons ?? rawButtons);

    return deliverPrivateReply(supabase, {
      context,
      nodeId: node.id,
      nodeType: "privateReply",
      sessionId,
      apiKey,
      lateAccountId,
      postId: String(postId),
      commentId: String(commentId),
      text: attributed.text,
      buttons,
      attachments: data.imageUrl ? [{ type: "image", url: data.imageUrl }] : null,
    });
  },
};
