/**
 * «Enviar al grupo» (Grupos de WhatsApp, 00344): manda un texto y/o un recurso de la banca (imagen, video, archivo,
 * texto o enlace) a un grupo activado. No necesita contacto (`needsContact: false`): el mensaje va al grupo. Con
 * «En una fecha y hora» sirve para mensajes y archivos programados a un grupo o a un grupo de una comunidad.
 *
 *   - El grupo tiene que estar activado y su numero conectado. Si solo los admins escriben y el numero no es admin,
 *     se saltea con ese motivo.
 *   - El texto admite variables ({{workspace.name}}…). Un recurso de texto o enlace se suma al texto; uno con
 *     archivo se manda con el texto como pie. Los audios no se mandan a grupos.
 *   - Un mismo paso, en la misma ejecucion, nunca manda dos veces al mismo grupo (`flow_send_claims`).
 *   - Respeta el tope de mensajes automaticos por hora del numero.
 *
 * Todo lo que no se puede hacer se SALTEA con el motivo y el flujo sigue: nunca lanza.
 */

import type { FlowExecutionContext } from "../types";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { interpolateVariables } from "../interpolate";
import { sendToGroup, type GroupOutbound } from "@/lib/whatsapp-groups/send";
import { cannotWriteReason } from "@/lib/whatsapp-groups/settings";
import { copyAssetToChat } from "@/lib/response-assets/send-copy";
import { groupMediaFolder } from "@/lib/whatsapp-groups/rules";
import { WHATSAPP_HOURLY_LIMIT } from "@/lib/channels/whatsapp-limits";
import { skipGroupStep } from "./group-step-skip";

export interface SendToGroupData {
  /** El grupo (`whatsapp_groups.id`). */
  groupId?: string;
  text?: string;
  /** Un recurso de la banca (`response_assets.id`). */
  assetId?: string;
}

export const SEND_TO_GROUP_TYPE = "send_to_group";
const LABEL = "Enviar al grupo";
const MAX_TEXT = 4096;

async function execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<SendToGroupData, FlowExecutionContext>): Promise<void> {
  const skip = (reason: string, extra: Record<string, unknown> = {}) =>
    skipGroupStep(supabase, context, node, { type: SEND_TO_GROUP_TYPE, label: LABEL }, reason, extra);

  try {
    if (!data.groupId) return await skip("No elegiste el grupo.");
    const vars = context.variables ?? {};
    let text = interpolateVariables(data.text ?? "", vars).trim();

    const { data: group } = await supabase
      .from("whatsapp_groups")
      .select("id, workspace_id, channel_id, group_jid, subject, in_inbox, save_contacts, left_at, announce, number_is_admin")
      .eq("id", data.groupId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (!group || group.left_at || (!group.in_inbox && !group.save_contacts)) return await skip("El grupo elegido no está activado.");
    const blocked = cannotWriteReason({ announce: group.announce, numberIsAdmin: group.number_is_admin });
    if (blocked) return await skip(blocked);

    const { data: channel } = await supabase
      .from("channels")
      .select("id, provider, evolution_instance, is_active")
      .eq("id", group.channel_id)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (!channel || channel.provider !== "evolution" || !channel.is_active || !channel.evolution_instance) {
      return await skip("El número de WhatsApp del grupo no está conectado.");
    }

    // El recurso: texto o enlace se suman al mensaje; un archivo va como adjunto (antes de reservar, por si no sirve).
    let media: GroupOutbound["media"] = null;
    if (data.assetId) {
      const { data: asset } = await supabase
        .from("response_assets")
        .select("id, kind, content, url, is_active, deleted_at")
        .eq("id", data.assetId)
        .eq("workspace_id", context.workspaceId)
        .maybeSingle();
      if (!asset || asset.deleted_at || !asset.is_active) return await skip("El recurso elegido ya no está disponible.");
      if (asset.kind === "audio") return await skip("Los audios no se pueden mandar a un grupo desde una automatización.");
      if (asset.kind === "text" || asset.kind === "link") {
        const extra = interpolateVariables([asset.content, asset.kind === "link" ? asset.url : null].filter(Boolean).join("\n"), vars).trim();
        text = [text, extra].filter(Boolean).join("\n\n");
      } else {
        const copied = await copyAssetToChat(supabase, { workspaceId: context.workspaceId, conversationId: groupMediaFolder(group.id), assetId: asset.id });
        if (!copied.ok) return await skip(copied.error);
        if (copied.copy.kind === "audio") return await skip("Los audios no se pueden mandar a un grupo desde una automatización.");
        media = { storagePath: copied.copy.storagePath, kind: copied.copy.kind, mime: copied.copy.mime, filename: copied.copy.filename };
      }
    }
    if (!text && !media) return await skip("El mensaje está vacío.");
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

    const { error: claimError } = await supabase.from("flow_send_claims").insert({
      workspace_id: context.workspaceId,
      session_id: sessionId,
      node_id: node.id,
      target: group.group_jid,
    });
    if (claimError) {
      if (claimError.code === "23505") return await skip("Este paso ya mandó el mensaje a ese grupo en esta ejecución.", { duplicate: true });
      return await skip("No pude reservar el envío, así que no se mandó.");
    }

    const { data: allowed, error: capError } = await supabase.rpc("claim_automated_send", { p_channel_id: channel.id, p_limit: WHATSAPP_HOURLY_LIMIT });
    if (capError) console.error("[flow-engine] no pude reclamar el envío al grupo, dejo pasar:", capError.message);
    else if (allowed === false) return await skip("El canal llegó al tope de mensajes automáticos de la hora: no se mandó.", { rate_limited: true });

    const result = await sendToGroup(supabase, group, { text: text || null, media }, { userId: null, flowId: context.flowId, nodeId: node.id });
    if (!result.ok) {
      context.noteStep?.({ status: "failed", reason: `No se mandó al grupo: ${result.error}` });
      await skip(`No se mandó al grupo: ${result.error}`);
    }
  } catch (err) {
    context.noteStep?.({ status: "failed", reason: "Algo falló al mandar al grupo." });
    await skip("Algo falló al mandar al grupo.", { error: err instanceof Error ? err.message.slice(0, 200) : "error" });
  }
}

export const sendToGroupNode: NodeDefinition<SendToGroupData> = {
  needsContact: false,
  requires: ["whatsapp_channel"],
  type: SEND_TO_GROUP_TYPE,
  label: LABEL,
  aliases: [{ nodeType: "action", actionType: SEND_TO_GROUP_TYPE }],
  execute,
};
