/**
 * «Enviar encuesta» (Grupos de WhatsApp): manda una encuesta a un grupo activado. No necesita contacto
 * (`needsContact: false`): la encuesta va al grupo, no a una persona.
 *
 * Los votos de esa encuesta pueden disparar «Votó en una encuesta de un grupo» con «A qué encuesta: las que manda
 * este paso» (`message_scope: flow_step`): por eso el mensaje queda guardado con el flujo y el paso que lo mandaron.
 *
 *   - El grupo tiene que estar activado (en la bandeja o guardando contactos) y su numero conectado.
 *   - La pregunta y las opciones admiten variables ({{contact.first_name}}…) y se validan al correr
 *     (`validatePoll`: de 2 a 12 opciones distintas).
 *   - Un mismo paso, en la misma sesion, nunca manda dos veces la encuesta al mismo grupo (`flow_send_claims`).
 *   - Respeta el tope de 200 mensajes automaticos por hora del canal.
 *
 * Todo lo que no se puede hacer se SALTEA con el motivo (`node_skipped`) y el flujo sigue: nunca lanza.
 */

import type { FlowExecutionContext } from "../types";
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { interpolateVariables } from "../interpolate";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { sendPoll } from "@/lib/evolution-client";
import { validatePoll } from "@/lib/whatsapp-groups/poll";
import type { Json } from "@/lib/types/database";

export interface SendPollData {
  /** El grupo (`whatsapp_groups.id`). */
  groupId?: string;
  question?: string;
  options?: string[];
  /** true = se pueden elegir varias opciones. */
  multiple?: boolean;
}

export const SEND_POLL_TYPE = "send_poll";

/** Tope de mensajes automaticos por hora y canal (el mismo del resto del motor). */
const HOURLY_LIMIT = 200;

async function execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<SendPollData, FlowExecutionContext>): Promise<void> {
  const label = "Enviar encuesta";
  const skip = async (reason: string, extra: Record<string, unknown> = {}): Promise<void> => {
    console.warn(`[flow-engine] el nodo ${node.id} (${SEND_POLL_TYPE}) se saltea: ${reason}`);
    try {
      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: context.contactId,
        event_type: "node_skipped",
        metadata: { nodeId: node.id, nodeType: SEND_POLL_TYPE, reason, ...extra },
      });
    } catch (err) {
      console.error("[flow-engine] no pude anotar el salto de la encuesta:", err instanceof Error ? err.message : String(err));
    }
    try {
      context.onStepSkipped?.({ nodeId: node.id, nodeType: SEND_POLL_TYPE, label });
    } catch {
      // Un aviso que falla no frena el flujo.
    }
  };

  try {
    if (!data.groupId) return await skip("No elegiste el grupo.");
    const vars = context.variables ?? {};
    const validation = validatePoll({
      question: interpolateVariables(data.question ?? "", vars),
      options: (data.options ?? []).map((option) => interpolateVariables(option ?? "", vars)),
      multiple: data.multiple === true,
    });
    if (!validation.ok) return await skip(validation.error);

    const { data: group } = await supabase
      .from("whatsapp_groups")
      .select("id, workspace_id, channel_id, group_jid, subject, in_inbox, save_contacts, left_at")
      .eq("id", data.groupId)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (!group || group.left_at || (!group.in_inbox && !group.save_contacts)) return await skip("El grupo elegido no está activado.");

    const { data: channel } = await supabase
      .from("channels")
      .select("id, provider, platform, evolution_instance, is_active")
      .eq("id", group.channel_id)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    if (!channel || channel.provider !== "evolution" || !channel.is_active || !channel.evolution_instance) {
      return await skip("El número de WhatsApp del grupo no está conectado.");
    }

    const { error: claimError } = await supabase.from("flow_send_claims").insert({
      workspace_id: context.workspaceId,
      session_id: sessionId,
      node_id: node.id,
      target: group.group_jid,
    });
    if (claimError) {
      if (claimError.code === "23505") return await skip("Este paso ya mandó la encuesta a ese grupo en esta ejecución.", { duplicate: true });
      return await skip("No pude reservar el envío, así que no se mandó.");
    }

    const { data: allowed, error: capError } = await supabase.rpc("claim_automated_send", { p_channel_id: channel.id, p_limit: HOURLY_LIMIT });
    if (capError) console.error("[flow-engine] no pude reclamar el envío de la encuesta, dejo pasar:", capError.message);
    else if (allowed === false) return await skip("El canal llegó al tope de mensajes automáticos de la hora: no se mandó.", { rate_limited: true });

    const config = await getEvolutionConfig(supabase, context.workspaceId);
    if (!config) return await skip("WhatsApp no está configurado en este entorno.");

    const poll = validation.poll;
    let platformId: string | null = null;
    let sendError: string | null = null;
    try {
      platformId = (await sendPoll(config, channel.evolution_instance, group.group_jid, poll)).id;
    } catch (err) {
      sendError = err instanceof Error ? err.message.slice(0, 300) : "No se pudo mandar la encuesta.";
    }

    // Queda en el hilo del grupo con el flujo y el paso que la mandaron (si el eco ya llego, se completa ese).
    const row = {
      workspace_id: group.workspace_id,
      group_id: group.id,
      platform_message_id: platformId,
      direction: "outbound" as const,
      text: null,
      poll: { name: poll.name, options: poll.values, selectableCount: poll.selectableCount } as unknown as Json,
      origin: "flow" as const,
      status: sendError ? ("failed" as const) : ("sent" as const),
      send_error: sendError,
      sent_by_flow_id: context.flowId,
      sent_by_node_id: node.id,
    };
    const { error: saveError } = platformId
      ? await supabase.from("whatsapp_group_messages").upsert(row, { onConflict: "group_id,platform_message_id" })
      : await supabase.from("whatsapp_group_messages").insert(row);
    if (saveError) console.error("[flow-engine] no pude guardar la encuesta en el hilo del grupo:", saveError.message);
    if (!sendError) {
      await supabase.from("whatsapp_groups").update({ last_message_at: new Date().toISOString(), last_message_preview: `📊 ${poll.name}` }).eq("id", group.id);
    } else {
      await skip(`WhatsApp no aceptó la encuesta: ${sendError}`);
    }
  } catch (err) {
    await skip("Algo falló al mandar la encuesta.", { error: err instanceof Error ? err.message.slice(0, 200) : "error" });
  }
}

export const sendPollNode: NodeDefinition<SendPollData> = {
  needsContact: false,
  requires: ["whatsapp_channel"],
  type: SEND_POLL_TYPE,
  label: "Enviar encuesta",
  aliases: [{ nodeType: "action", actionType: SEND_POLL_TYPE }],
  execute,
};
