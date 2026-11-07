/**
 * Mandar a un grupo de WhatsApp: texto, un archivo o una encuesta. Solo servidor (cliente de servicio, DESPUES de
 * que quien llama chequeo el permiso).
 *
 * El mensaje se guarda en el hilo del grupo con el id que devolvio WhatsApp. El eco que despues manda Evolution
 * trae el mismo id: el `upsert` sobre `(group_id, platform_message_id)` lo junta con esta fila (si el eco llego
 * primero, esta fila lo completa con quien lo mando). Si WhatsApp no lo acepta, queda `failed` con el motivo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { EvolutionError, sendMedia, sendPoll, sendText } from "@/lib/evolution-client";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { CHAT_MEDIA_BUCKET, SIGNED_URL_SECONDS } from "@/lib/chat-media/bucket";
import { toAttachmentsColumn, type ChatAttachment } from "@/lib/messages/attachments";
import { makeRoomForLiveSend } from "@/lib/send-queue/live-send";

type Db = SupabaseClient<Database>;

export interface GroupOutbound {
  text?: string | null;
  media?: { storagePath: string; kind: "image" | "video" | "document"; mime: string; filename: string | null } | null;
  poll?: { name: string; values: string[]; selectableCount: number } | null;
}

export interface GroupSendTarget {
  id: string;
  workspace_id: string;
  channel_id: string;
  group_jid: string;
}

export type GroupSendResult = { ok: true; messageId: string | null } | { ok: false; error: string; messageId: string | null };

function previewOf(out: GroupOutbound): string {
  if (out.poll) return `📊 ${out.poll.name}`;
  if (out.text?.trim()) return out.text.trim().slice(0, 120);
  if (out.media) return out.media.kind === "image" ? "📷 Foto" : out.media.kind === "video" ? "🎬 Video" : "📎 Archivo";
  return "";
}

export async function sendToGroup(
  db: Db,
  group: GroupSendTarget,
  out: GroupOutbound,
  sentBy: { userId: string | null; flowId?: string | null; nodeId?: string | null },
): Promise<GroupSendResult> {
  const { data: channel } = await db
    .from("channels")
    .select("id, provider, evolution_instance, is_active")
    .eq("id", group.channel_id)
    .eq("workspace_id", group.workspace_id)
    .maybeSingle();
  if (!channel || channel.provider !== "evolution" || !channel.is_active || !channel.evolution_instance) {
    return { ok: false, error: "El número de WhatsApp del grupo no está conectado.", messageId: null };
  }
  const config = await getEvolutionConfig(db, group.workspace_id);
  if (!config) return { ok: false, error: "WhatsApp no está configurado en este sistema.", messageId: null };
  const instance = channel.evolution_instance;

  let platformId: string | null = null;
  let sendError: string | null = null;
  /** Si el mensaje llego a pedirse a WhatsApp (un archivo que no se pudo leer, no). */
  let attempted = false;
  const attachments: ChatAttachment[] = [];
  try {
    if (out.poll) {
      attempted = true;
      platformId = (await sendPoll(config, instance, group.group_jid, out.poll)).id;
    } else if (out.media) {
      const { data: signed, error } = await db.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(out.media.storagePath, SIGNED_URL_SECONDS);
      if (error || !signed?.signedUrl) throw new Error("No pude leer el archivo subido.");
      attempted = true;
      platformId = (
        await sendMedia(config, instance, group.group_jid, {
          media: signed.signedUrl,
          mediatype: out.media.kind,
          mimetype: out.media.mime,
          caption: out.text?.trim() || null,
          fileName: out.media.filename,
        })
      ).id;
      attachments.push({
        kind: out.media.kind,
        storagePath: out.media.storagePath,
        sourceUrl: null,
        mime: out.media.mime,
        filename: out.media.filename,
        sizeBytes: null,
        durationSeconds: null,
        status: "ready",
        error: null,
        meta: null,
      });
    } else {
      attempted = true;
      platformId = (await sendText(config, instance, group.group_jid, out.text ?? "")).id;
    }
  } catch (err) {
    sendError = err instanceof EvolutionError ? `WhatsApp no lo aceptó (${err.status ?? "sin respuesta"}).` : err instanceof Error ? err.message.slice(0, 300) : "No se pudo mandar.";
  }
  // Un mensaje a un grupo sale por el mismo numero: la cola de broadcasts de ese numero espera su espera minima.
  if (attempted) await makeRoomForLiveSend({ client: db, channelId: channel.id });

  const row = {
    workspace_id: group.workspace_id,
    group_id: group.id,
    platform_message_id: platformId,
    direction: "outbound" as const,
    text: out.text?.trim() || null,
    attachments: toAttachmentsColumn(attachments) as unknown as Json,
    poll: (out.poll ? { name: out.poll.name, options: out.poll.values, selectableCount: out.poll.selectableCount } : null) as unknown as Json,
    origin: sentBy.flowId ? ("flow" as const) : ("app" as const),
    status: sendError ? ("failed" as const) : ("sent" as const),
    send_error: sendError,
    sent_by_user_id: sentBy.userId,
    sent_by_flow_id: sentBy.flowId ?? null,
    sent_by_node_id: sentBy.nodeId ?? null,
  };
  const { data: saved, error: saveError } = platformId
    ? await db.from("whatsapp_group_messages").upsert(row, { onConflict: "group_id,platform_message_id" }).select("id").maybeSingle()
    : await db.from("whatsapp_group_messages").insert(row).select("id").maybeSingle();
  if (saveError) console.error("[grupos] no pude guardar el mensaje enviado:", saveError.message);

  if (!sendError) {
    await db.from("whatsapp_groups").update({ last_message_at: new Date().toISOString(), last_message_preview: previewOf(out), unread_count: 0 }).eq("id", group.id);
    return { ok: true, messageId: saved?.id ?? null };
  }
  return { ok: false, error: sendError, messageId: saved?.id ?? null };
}
