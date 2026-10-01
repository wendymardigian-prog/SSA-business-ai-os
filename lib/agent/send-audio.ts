import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { sendChannelMessage, type SendOutcome } from "@/lib/flow-engine/send";
import { outboundMessageRow } from "@/lib/messages/outbound";
import { emptyAttachment, toAttachmentsColumn } from "@/lib/messages/attachments";
import { messagePreview } from "@/lib/message-preview";
import { extensionForMime } from "@/lib/chat-media/bucket";
import { logAudit } from "@/lib/audit";
import type { AgentSendContext } from "./send";

/**
 * Manda un audio de la banca que el agente eligio con enviar_audio (F22).
 *
 * Mismo camino que sendAgentParts: sendChannelMessage, un mensaje en
 * `messages` con la autoria del agente, y conversations.last_message_at. La
 * diferencia es que va DESPUES del texto (el runner lo llama una sola vez,
 * al final, si enviar_audio dejo algo en turn.memo) y que la fila lleva la
 * transcripcion ya lista en `text`: no hay nada que volver a transcribir.
 */

type Db = SupabaseClient<Database>;

export interface AgentAudioToSend {
  audioAssetId: string;
  name: string;
  storagePath: string;
  mimeType: string;
  durationSeconds: number | null;
  transcript: string;
}

export interface AgentAudioSendResult {
  ok: boolean;
  messageId: string | null;
  failure: SendOutcome["failure"] | null;
}

export async function sendAgentAudio(
  supabase: Db,
  ctx: AgentSendContext,
  audio: AgentAudioToSend,
): Promise<AgentAudioSendResult> {
  const filename = `${audio.name}.${extensionForMime(audio.mimeType)}`;

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
      text: audio.transcript,
      media: {
        kind: "audio",
        storagePath: audio.storagePath,
        mime: audio.mimeType,
        filename,
        durationSeconds: audio.durationSeconds,
      },
    },
  );

  const attachmentsColumn = toAttachmentsColumn([
    emptyAttachment("audio", {
      storagePath: audio.storagePath,
      mime: audio.mimeType,
      filename,
      durationSeconds: audio.durationSeconds,
      status: "ready",
    }),
  ]);

  const { data: stored, error } = await supabase
    .from("messages")
    .insert(
      outboundMessageRow({
        conversationId: ctx.conversationId,
        origin: "agent",
        text: outcome.ok ? audio.transcript : (outcome.failure?.message ?? audio.transcript),
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

  if (error) console.error("[agent-send-audio] no pude guardar el mensaje:", error.message);

  if (!outcome.ok) {
    return { ok: false, messageId: stored?.id ?? null, failure: outcome.failure ?? null };
  }

  await supabase
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: messagePreview(audio.transcript) || `🎤 ${audio.name}`,
    })
    .eq("id", ctx.conversationId);

  await logAudit({
    supabase,
    workspaceId: ctx.workspaceId,
    entityType: "audio_asset",
    entityId: audio.audioAssetId,
    action: "agent_audio_sent",
    metadata: { conversation_id: ctx.conversationId, message_id: stored?.id ?? null },
    performedByAgentId: ctx.agentId,
  });

  return { ok: true, messageId: stored?.id ?? null, failure: null };
}
