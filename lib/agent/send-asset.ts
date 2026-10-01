import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { sendChannelMessage, type SendOutcome } from "@/lib/flow-engine/send";
import { outboundMessageRow } from "@/lib/messages/outbound";
import { emptyAttachment, toAttachmentsColumn } from "@/lib/messages/attachments";
import { messagePreview } from "@/lib/message-preview";
import { logAudit } from "@/lib/audit";
import { copyAssetToChat } from "@/lib/response-assets/send-copy";
import type { AgentSendContext } from "./send";

/**
 * Manda un audio de la banca que el agente eligio con usar_recurso.
 *
 * Mismo camino que sendAgentParts: sendChannelMessage, un mensaje en
 * `messages` con la autoria del agente, y conversations.last_message_at. Dos
 * diferencias con un texto: va DESPUES (el runner lo llama una sola vez, al
 * final, si usar_recurso dejo algo en turn.memo) y la fila lleva la
 * transcripcion ya lista en `text` -- no hay nada que volver a transcribir.
 *
 * Antes de mandar, copia el archivo de la biblioteca a la conversacion
 * (lib/response-assets/send-copy.ts): el path de biblioteca no pasa el guard
 * de `validateOutboundMedia`, y si entrara igual en `messages.attachments`,
 * el barrido de retencion de 180 dias se llevaria el archivo de la
 * biblioteca -- no solo el de este mensaje.
 */

type Db = SupabaseClient<Database>;

export interface AgentAssetToSend {
  assetId: string;
  name: string;
  /** El path EN LA BIBLIOTECA (<ws>/library/<uuid>.<ext>): se copia antes de mandar. */
  storagePath: string;
  mimeType: string;
  durationSeconds: number | null;
  transcript: string;
}

export interface AgentAssetSendResult {
  ok: boolean;
  messageId: string | null;
  failure: SendOutcome["failure"] | null;
}

export async function sendAgentAsset(
  supabase: Db,
  ctx: AgentSendContext,
  asset: AgentAssetToSend,
): Promise<AgentAssetSendResult> {
  const copied = await copyAssetToChat(supabase, {
    workspaceId: ctx.workspaceId,
    conversationId: ctx.conversationId,
    assetId: asset.assetId,
  });

  if (!copied.ok) {
    console.error("[agent-send-asset] no pude copiar el audio a la conversacion:", copied.error);
    return { ok: false, messageId: null, failure: { kind: "unknown", message: copied.error, retryable: true } };
  }

  const { storagePath, mime, filename, durationSeconds } = copied.copy;

  const outcome = await sendChannelMessage(
    supabase,
    {
      workspaceId: ctx.workspaceId,
      channelId: ctx.channelId,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      lateConversationId: ctx.lateConversationId ?? undefined,
      flowId: null,
    },
    {
      text: asset.transcript,
      media: { kind: "audio", storagePath, mime, filename, durationSeconds },
    },
  );

  const attachmentsColumn = toAttachmentsColumn([
    emptyAttachment("audio", { storagePath, mime, filename, durationSeconds, status: "ready" }),
  ]);

  const { data: stored, error } = await supabase
    .from("messages")
    .insert(
      outboundMessageRow({
        conversationId: ctx.conversationId,
        origin: "agent",
        text: outcome.ok ? asset.transcript : (outcome.failure?.message ?? asset.transcript),
        attachments: attachmentsColumn,
        sentByAgentId: ctx.agentId,
        sentByUserId: ctx.sentByUserId ?? null,
        agentRunId: ctx.runId,
        platformMessageId: outcome.platformMessageId ?? null,
        status: outcome.ok ? "sent" : "failed",
      }),
    )
    .select("id")
    .single();

  if (error) console.error("[agent-send-asset] no pude guardar el mensaje:", error.message);

  if (!outcome.ok) {
    return { ok: false, messageId: stored?.id ?? null, failure: outcome.failure ?? null };
  }

  await supabase
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: messagePreview(asset.transcript) || `🎤 ${asset.name}`,
    })
    .eq("id", ctx.conversationId);

  await logAudit({
    supabase,
    workspaceId: ctx.workspaceId,
    entityType: "response_asset",
    entityId: asset.assetId,
    action: "agent_asset_sent",
    metadata: { conversation_id: ctx.conversationId, message_id: stored?.id ?? null },
    performedByAgentId: ctx.agentId,
  });

  return { ok: true, messageId: stored?.id ?? null, failure: null };
}
