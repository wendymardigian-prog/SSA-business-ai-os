/**
 * Mandar un recurso de la banca desde una AUTOMATIZACION (un flow o una
 * secuencia), con un solo camino.
 *
 * Lo usan el nodo "Enviar recurso" de los flows y el paso "Recurso" de las
 * secuencias. El agente tiene el suyo (`lib/agent/send-asset.ts`, con su
 * autoria y su modo borrador); aca no hay agente.
 *
 * Reglas que valen para los seis tipos:
 *
 *  - **El canal decide.** `channelAccepts` es el unico lugar que sabe que manda
 *    cada canal: un audio por Instagram solo si el formato lo acepta, un
 *    archivo no por Instagram, y por email solo texto y enlace. Lo que el canal
 *    no acepta NO se manda y se dice por que (`skipped`): una automatizacion
 *    que sigue de largo sin avisar es peor que una que avisa.
 *  - **Nunca se manda el archivo de la biblioteca**, siempre una COPIA a la
 *    conversacion (`copyAssetToChat`): el barrido de retencion de la media del
 *    chat se llevaria el original.
 *  - **Las variables salen de los datos reales** del contacto y del negocio
 *    ({{contact.display_name}}, {{workspace.name}}...): la automatizacion no
 *    sabe de antemano a quien le va a escribir.
 *  - **Un audio sale solo.** Su transcripcion queda guardada como texto del
 *    mensaje (para el historial y para el agente) pero no viaja por el canal.
 *  - El uso se cuenta DESPUES de mandar y sin poder frenarlo.
 *
 * Nunca lanza: devuelve el resultado y el que llama decide (un flow sigue; una
 * secuencia reintenta solo lo que vale la pena reintentar).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { sendChannelMessage, recordSend, type SendContext } from "@/lib/flow-engine/send";
import { channelAccepts } from "@/lib/channels/media";
import { interpolateTemplate } from "@/lib/templates/interpolate";
import { emptyAttachment, toAttachmentsColumn } from "@/lib/messages/attachments";
import { copyAssetToChat } from "@/lib/response-assets/send-copy";
import { touchAssetUsage } from "@/lib/response-assets/usage";
import { hasFile, type AssetKind } from "@/lib/response-assets/kind";

type Db = SupabaseClient<Database>;

export type DeliverAssetOutcome =
  | { ok: true; kind: AssetKind }
  /** No se intento: el recurso no existe o esta apagado, el canal no lo acepta, falta la conversacion. */
  | { ok: false; status: "skipped"; reason: string }
  /** Se intento y no salio. `retryable` = vale la pena volver a probar (el canal esta frenado). */
  | { ok: false; status: "failed"; reason: string; retryable: boolean };

interface AssetRow {
  id: string;
  kind: AssetKind;
  name: string;
  content: string | null;
  url: string | null;
  caption: string | null;
  mime_type: string | null;
  transcript: string | null;
  transcript_status: string;
}

/**
 * El texto de un recurso que NO tiene archivo (un texto o un enlace), ya con
 * sus variables resueltas. Puro: lo comparten el envio y la vista previa.
 */
export function plainAssetText(
  asset: Pick<AssetRow, "kind" | "content" | "url">,
  extra: string | null | undefined,
  data: Parameters<typeof interpolateTemplate>[1],
): string {
  const lead = interpolateTemplate((extra ?? "").trim(), data).trim();
  if (asset.kind === "text") return interpolateTemplate((asset.content ?? "").trim(), data).trim();
  // Un enlace: el texto que se le sume (si hay) y la direccion, tal cual.
  return [lead, asset.url ?? ""].filter(Boolean).join("\n");
}

export async function deliverAsset(
  supabase: Db,
  args: {
    assetId: string;
    /** Un texto propio que acompaña al recurso: reemplaza al del recurso. Admite las variables de la banca. */
    caption?: string | null;
    context: Omit<SendContext, "channelId" | "conversationId"> & {
      channelId: string | null;
      conversationId: string | null;
    };
  },
): Promise<DeliverAssetOutcome> {
  const { context } = args;
  const skipped = (reason: string): DeliverAssetOutcome => ({ ok: false, status: "skipped", reason });

  if (!context.channelId || !context.conversationId) {
    return skipped("No hay una conversación abierta con este contacto: no hay por dónde mandarlo.");
  }
  const send: SendContext = { ...context, channelId: context.channelId, conversationId: context.conversationId };

  try {
    const { data: asset } = await supabase
      .from("response_assets")
      .select("id, kind, name, content, url, caption, mime_type, transcript, transcript_status")
      .eq("id", args.assetId)
      .eq("workspace_id", context.workspaceId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (!asset) return skipped("El recurso ya no existe o está desactivado.");
    const row = asset as AssetRow;

    const { data: channel } = await supabase.from("channels").select("provider").eq("id", context.channelId).maybeSingle();
    if (!channel) return skipped("No encontré el canal de la conversación.");

    const accepts = channelAccepts(channel.provider, row.kind, hasFile(row.kind) ? row.mime_type : undefined);
    if (!accepts.ok) return skipped(accepts.reason);

    // Las variables, con los datos de verdad del contacto y del negocio.
    const [{ data: contact }, { data: workspace }] = await Promise.all([
      supabase.from("contacts").select("display_name, email, phone").eq("id", context.contactId).maybeSingle(),
      supabase.from("workspaces").select("name").eq("id", context.workspaceId).maybeSingle(),
    ]);
    const data = { contact, workspace };

    // Texto y enlace: no llevan archivo.
    if (!hasFile(row.kind)) {
      const text = plainAssetText(row, args.caption, data);
      if (!text) return skipped("El recurso no tiene texto para mandar.");

      const outcome = await sendChannelMessage(supabase, send, { text });
      await recordSend(supabase, send, outcome.ok ? text : (outcome.failure?.message ?? text), outcome);
      if (!outcome.ok) {
        return { ok: false, status: "failed", reason: outcome.failure?.message ?? "No se pudo enviar", retryable: outcome.failure?.kind === "rate_limited" };
      }
      await touchAssetUsage(supabase, row.id);
      return { ok: true, kind: row.kind };
    }

    // Con archivo: se copia a la conversacion y se manda la copia.
    const copied = await copyAssetToChat(supabase, {
      workspaceId: context.workspaceId,
      conversationId: context.conversationId,
      assetId: row.id,
    });
    if (!copied.ok) return { ok: false, status: "failed", reason: copied.error, retryable: true };

    const { kind, storagePath, mime, filename, durationSeconds, sizeBytes } = copied.copy;
    const isAudio = copied.copy.assetKind === "audio";
    // Un audio sale solo; lo demas lleva su texto (el del paso, o el del recurso).
    const wireText = isAudio
      ? ""
      : interpolateTemplate(((args.caption ?? "").trim() || (copied.copy.caption ?? "")).trim(), data).trim();
    // Lo que se guarda como texto del mensaje: la transcripcion de un audio (para el historial).
    const storedText = isAudio ? (row.transcript_status === "ready" ? (row.transcript ?? "") : "") : wireText;

    const outcome = await sendChannelMessage(supabase, send, {
      text: wireText,
      media: { kind, storagePath, mime, filename, durationSeconds },
    });

    const attachments = toAttachmentsColumn([
      emptyAttachment(kind, { storagePath, mime, filename, durationSeconds, sizeBytes, status: "ready" }),
    ]);
    await recordSend(supabase, send, outcome.ok ? storedText : (outcome.failure?.message ?? storedText), outcome, attachments);

    if (!outcome.ok) {
      return { ok: false, status: "failed", reason: outcome.failure?.message ?? "No se pudo enviar", retryable: outcome.failure?.kind === "rate_limited" };
    }
    await touchAssetUsage(supabase, row.id);
    return { ok: true, kind: row.kind };
  } catch (err) {
    console.error("[deliver-asset] error inesperado:", err instanceof Error ? err.message : err);
    return { ok: false, status: "failed", reason: "Falló el envío del recurso.", retryable: false };
  }
}
