/**
 * «Invitar a un grupo» (Grupos de WhatsApp, 00344): suma al contacto a un grupo. Si WhatsApp no deja agregarlo (su
 * privacidad no lo permite, o no esta en los contactos del numero), le manda el link de invitacion por privado,
 * desde el numero del grupo. Necesita contacto.
 *
 *   - El grupo tiene que estar activado, con su numero conectado, y el numero tiene que ser admin del grupo.
 *   - Respeta «no contactar» (no lo agrega ni le escribe).
 *   - Usa el WhatsApp del contacto o, si no tiene, su telefono.
 *   - Un mismo paso, en la misma ejecucion, nunca lo invita dos veces (`flow_send_claims`), y el link por privado
 *     cuenta para el tope de mensajes automaticos por hora del numero.
 *
 * Todo lo que no se puede hacer se SALTEA con el motivo y el flujo sigue: nunca lanza.
 */

import type { FlowExecutionContext } from "../types";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { fetchGroupInviteLink, updateGroupParticipants } from "@/lib/evolution-client";
import { normalizePhone } from "@/lib/phone";
import { inviteMessage } from "@/lib/whatsapp-groups/manage";
import { WHATSAPP_HOURLY_LIMIT } from "@/lib/channels/whatsapp-limits";
import { sendEvolutionDirect } from "../send";
import { skipGroupStep } from "./group-step-skip";

export interface InviteToGroupData {
  /** El grupo (`whatsapp_groups.id`). */
  groupId?: string;
  /** true = no intenta agregar: manda directamente el link por privado. */
  linkOnly?: boolean;
}

export const INVITE_TO_GROUP_TYPE = "invite_to_group";
const LABEL = "Invitar a un grupo";

async function execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<InviteToGroupData, FlowExecutionContext>): Promise<void> {
  const skip = (reason: string, extra: Record<string, unknown> = {}) =>
    skipGroupStep(supabase, context, node, { type: INVITE_TO_GROUP_TYPE, label: LABEL }, reason, extra);

  try {
    if (!data.groupId) return await skip("No elegiste el grupo.");
    if (!context.contactId) return await skip("Esta ejecución no tiene un contacto.");

    const { data: contact } = await supabase
      .from("contacts")
      .select("id, phone, whatsapp_phone, do_not_contact")
      .eq("id", context.contactId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (!contact) return await skip("No encontré el contacto.");
    if (contact.do_not_contact) return await skip("El contacto está marcado «no contactar»: no se lo invitó.");
    const phone = normalizePhone(contact.whatsapp_phone) ?? normalizePhone(contact.phone);
    if (!phone) return await skip("El contacto no tiene un teléfono de WhatsApp.");

    const { data: group } = await supabase
      .from("whatsapp_groups")
      .select("id, workspace_id, channel_id, group_jid, subject, in_inbox, save_contacts, left_at, number_is_admin")
      .eq("id", data.groupId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (!group || group.left_at || (!group.in_inbox && !group.save_contacts)) return await skip("El grupo elegido no está activado.");
    if (group.number_is_admin === false) return await skip("El número no es admin del grupo: WhatsApp no deja invitar.");

    const { data: channel } = await supabase
      .from("channels")
      .select("id, provider, evolution_instance, is_active")
      .eq("id", group.channel_id)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (!channel || channel.provider !== "evolution" || !channel.is_active || !channel.evolution_instance) {
      return await skip("El número de WhatsApp del grupo no está conectado.");
    }
    const config = await getEvolutionConfig(supabase, context.workspaceId);
    if (!config) return await skip("WhatsApp no está configurado en este entorno.");
    const instance = channel.evolution_instance;

    const { error: claimError } = await supabase.from("flow_send_claims").insert({
      workspace_id: context.workspaceId,
      session_id: sessionId,
      node_id: node.id,
      target: `${group.group_jid}:${phone}`,
    });
    if (claimError) {
      if (claimError.code === "23505") return await skip("Este paso ya invitó a este contacto en esta ejecución.", { duplicate: true });
      return await skip("No pude reservar la invitación, así que no se hizo.");
    }

    if (!data.linkOnly) {
      const [result] = await updateGroupParticipants(config, instance, group.group_jid, "add", [phone]);
      if (result?.status === "ok") return;
    }

    // No se pudo agregar (o se pidio solo el link): el link por privado, que cuenta como un mensaje automatico.
    const { data: allowed, error: capError } = await supabase.rpc("claim_automated_send", { p_channel_id: channel.id, p_limit: WHATSAPP_HOURLY_LIMIT });
    if (capError) console.error("[flow-engine] no pude reclamar el envío de la invitación, dejo pasar:", capError.message);
    else if (allowed === false) return await skip("El canal llegó al tope de mensajes automáticos de la hora: no se mandó el link.", { rate_limited: true });

    const link = await fetchGroupInviteLink(config, instance, group.group_jid);
    const outcome = await sendEvolutionDirect(supabase, config, instance, phone, { text: inviteMessage(group.subject, link) }, { client: supabase, channelId: channel.id });
    if (!outcome.ok) {
      context.noteStep?.({ status: "failed", reason: outcome.failure?.message ?? "No se pudo mandar el link de invitación." });
      await skip(`No se mandó el link: ${outcome.failure?.message ?? "WhatsApp no lo aceptó"}`);
    }
  } catch (err) {
    context.noteStep?.({ status: "failed", reason: "Algo falló al invitar al grupo." });
    await skip("Algo falló al invitar al grupo.", { error: err instanceof Error ? err.message.slice(0, 200) : "error" });
  }
}

export const inviteToGroupNode: NodeDefinition<InviteToGroupData> = {
  needsContact: true,
  requires: ["whatsapp_channel"],
  type: INVITE_TO_GROUP_TYPE,
  label: LABEL,
  aliases: [{ nodeType: "action", actionType: INVITE_TO_GROUP_TYPE }],
  execute,
};
