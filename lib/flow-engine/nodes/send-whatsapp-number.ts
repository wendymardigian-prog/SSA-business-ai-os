/**
 * «Enviar WhatsApp a un número» (Extra L, Tirón 2, D3): un aviso a un número que puede no ser de ningún contacto
 * (por ejemplo, el aviso a la dueña cuando entra un lead por un webhook). No necesita contacto: `needsContact: false`.
 *
 * Es un paso APARTE y no una opción de «Enviar mensaje» a propósito: «Enviar mensaje» sigue intacto (cero riesgo para los
 * flujos que ya existen) y este paso tiene sus propias reglas, que son distintas:
 *
 *   - El destino es un número fijo o el de una variable (`{{webhook.payload.telefono}}`), normalizado con `lib/phone.ts`.
 *   - El canal es un WhatsApp conectado del workspace (por Evolution) que se ELIGE en el paso.
 *   - Se busca el número con la función única de contactos (`find_only`: nunca crea nada). Si es de un contacto marcado
 *     «no contactar», no se manda. Si es de un contacto con conversación en ese canal, el mensaje se guarda ahí como
 *     cualquier envío. Si no es de nadie (o no tiene conversación), se manda igual sin crear contacto ni conversación y
 *     queda en el historial del flujo (a qué número, qué texto y el resultado).
 *   - Un mismo paso, en la misma sesión, nunca manda dos veces al mismo número (`flow_send_claims`, 00222).
 *   - Respeta el tope de 200 mensajes automáticos por hora del canal (`claim_automated_send`).
 *
 * Todo lo que no se puede hacer se SALTEA con el motivo anotado (`node_skipped`) y el flujo sigue: nunca lanza.
 */

import type { FlowExecutionContext } from "../types";
import type { NodeDefinition, NodeExecutionArgs, NodeResult } from "../registry/types";
import { interpolateVariables } from "../interpolate";
import { resolveWhatsAppTarget } from "../whatsapp-target";
import { recordSend, sendChannelMessage, sendEvolutionDirect } from "../send";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { findContact } from "@/lib/contacts/find-or-create";
import { WHATSAPP_HOURLY_LIMIT } from "@/lib/channels/whatsapp-limits";
import { deferFlowNode } from "../defer-node";
import { sendWindowOf, windowOpening } from "../send-window";
import { businessTimeZone } from "@/lib/scheduled-flows/jobs";
import { lookbackFrom, normalizeHoursBefore, sessionStartedAt, teamWroteOnWhatsAppSince } from "../team-wrote";

export interface SendWhatsAppNumberData {
  to?: "fixed" | "variable";
  /** Solo `to: "fixed"`: el número tal como lo escribió la persona. */
  fixedPhone?: string;
  /** Solo `to: "variable"`: `{{webhook.payload.telefono}}` (también se acepta sin las llaves). */
  toVariable?: string;
  /** El canal de WhatsApp que manda. Obligatorio. */
  channelId?: string;
  text?: string;
  /** Un archivo por URL pública, como «Enviar mensaje». */
  mediaUrl?: string;
  mediaType?: string;
  /** «Mandar solo en este horario» (hora del negocio). Apagado = sale a la hora que le toca. Ver `send-window.ts`. */
  windowEnabled?: boolean;
  windowFrom?: string;
  windowTo?: string;
  /**
   * «No mandar si alguien del equipo ya le escribió por WhatsApp desde que arrancó la automatización» (desde el
   * teléfono o desde la bandeja). Se mira al momento de mandar, también cuando el paso esperó al horario de envío.
   * Ver `team-wrote.ts`. Apagado = sale siempre, como antes.
   */
  skipIfTeamWrote?: boolean;
  /**
   * Con `skipIfTeamWrote`: contar también lo que se le escribió en las X horas ANTES de que arrancara la automatización
   * (por ejemplo, le pasaste el link y agendó al rato). Vacío o 0 = solo desde que arrancó. Tope: una semana.
   */
  teamWroteHoursBefore?: number;
}

export const SEND_WHATSAPP_NUMBER_TYPE = "send_whatsapp_number";

const MAX_TEXT_IN_HISTORY = 500;

export { resolveWhatsAppTarget, hasUnresolvedVariable, type TargetResolution } from "../whatsapp-target";

async function execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<SendWhatsAppNumberData, FlowExecutionContext>): Promise<NodeResult | void> {
  const label = typeof (node.data as { label?: unknown } | undefined)?.label === "string" && String((node.data as { label?: string }).label).trim()
    ? String((node.data as { label?: string }).label).trim()
    : "Enviar WhatsApp a un número";

  /** Saltea el paso con el motivo: se anota en el historial del flujo y en el del envío del webhook. Nunca lanza. */
  const skip = async (reason: string, extra: Record<string, unknown> = {}): Promise<void> => {
    console.warn(`[flow-engine] el nodo ${node.id} (${SEND_WHATSAPP_NUMBER_TYPE}) se saltea: ${reason}`);
    context.noteStep?.({ status: "skipped", reason });
    try {
      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: (extra.contact_id as string | undefined) ?? context.contactId,
        event_type: "node_skipped",
        metadata: { nodeId: node.id, nodeType: SEND_WHATSAPP_NUMBER_TYPE, reason, ...extra },
      });
    } catch (err) {
      console.error("[flow-engine] no pude anotar el salto del paso de WhatsApp:", err instanceof Error ? err.message : String(err));
    }
    try {
      context.onStepSkipped?.({ nodeId: node.id, nodeType: SEND_WHATSAPP_NUMBER_TYPE, label });
    } catch {
      // Un aviso que falla no frena el flujo.
    }
  };

  // 1. El número.
  const target = resolveWhatsAppTarget(data, context.variables ?? {});
  if (!target.ok) return skip(target.reason);
  const phone = target.phone;

  // 2. El canal: un WhatsApp conectado de ESTE workspace.
  if (!data.channelId) return skip("No elegiste el canal de WhatsApp que manda el mensaje.");
  const { data: channel } = await supabase
    .from("channels")
    .select("id, provider, platform, evolution_instance, is_active")
    .eq("id", data.channelId)
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();
  if (!channel || channel.platform !== "whatsapp" || channel.provider !== "evolution" || !channel.is_active || !channel.evolution_instance) {
    return skip("El canal de WhatsApp elegido no existe o no está conectado.");
  }

  // 3. Qué se manda.
  const text = interpolateVariables(data.text ?? "", context.variables ?? {}).trim();
  const mediaUrl = data.mediaUrl?.trim() || undefined;
  if (!text && !mediaUrl) return skip("El mensaje está vacío.");

  // 3b. El horario de envío: fuera de la ventana el paso no falla ni se pierde, queda para cuando abre y se vuelve a
  //     correr ENTONCES (`deferFlowNode`). Va antes de la reserva (5) y del tope por hora (6): lo que queda para después
  //     no gasta ninguna de las dos. La zona es la del negocio; si no se puede leer, se lanza (adivinarla mandaría el
  //     mensaje a otra hora).
  const sendWindow = sendWindowOf(data);
  if (sendWindow) {
    const tz = await businessTimeZone(supabase, context.workspaceId);
    const opensAt = windowOpening(new Date(), tz, sendWindow);
    if (opensAt) {
      return deferFlowNode(supabase, {
        nodeId: node.id,
        nodeType: SEND_WHATSAPP_NUMBER_TYPE,
        sessionId,
        context,
        retryAt: opensAt,
        reason: "send_window",
        message: `Fuera del horario de envío (${sendWindow.from} a ${sendWindow.to}): el WhatsApp sale a las ${sendWindow.from}.`,
      });
    }
  }

  // 4. ¿Es de un contacto? Solo se busca, nunca se crea. Un error de la base NO se toma como «no es de nadie»:
  //    mandarle a alguien marcado «no contactar» por no haber podido mirar sería peor que no mandar.
  let contactId: string | null = null;
  try {
    const found = await findContact(supabase, { workspaceId: context.workspaceId, identity: { phone, whatsapp_phone: phone } });
    contactId = found.contactId;
  } catch (err) {
    return skip("No pude comprobar si el número es de un contacto, así que no se mandó.", { error: err instanceof Error ? err.message.slice(0, 200) : "error" });
  }

  let conversationId: string | null = null;
  if (contactId) {
    const { data: contact, error } = await supabase.from("contacts").select("do_not_contact").eq("id", contactId).maybeSingle();
    if (error) return skip("No pude comprobar si el contacto está marcado «no contactar», así que no se mandó.", { contact_id: contactId });
    if (contact?.do_not_contact) return skip("El contacto de ese número está marcado «no contactar»: no se mandó.", { contact_id: contactId });

    const { data: conversation } = await supabase.from("conversations").select("id").eq("channel_id", channel.id).eq("contact_id", contactId).maybeSingle();
    conversationId = conversation?.id ?? null;
  }

  // 4b. «No mandar si ya le escribiste»: se mira AHORA (después del horario de envío), así lo que escribiste mientras
  //     el paso esperaba también cuenta. Se busca por el contacto Y por el número (también escrito de la otra forma:
  //     +52 / +521 en México, +54 / +549 en Argentina), porque la misma persona puede estar dos veces. Sin saber desde
  //     cuándo (simulador) no se frena nada.
  if (data.skipIfTeamWrote) {
    const startedAt = await sessionStartedAt(supabase, sessionId);
    if (startedAt) {
      const hoursBefore = normalizeHoursBefore(data.teamWroteHoursBefore);
      const since = lookbackFrom(startedAt, hoursBefore);
      const wrote = await teamWroteOnWhatsAppSince(supabase, { workspaceId: context.workspaceId, contactId, phone, since });
      if (wrote === null) return skip("No pude comprobar si alguien del equipo ya le escribió, así que no se mandó.", { contact_id: contactId });
      if (wrote) {
        const when = hoursBefore > 0 ? `en las ${hoursBefore} h antes de que empezara la automatización o después` : "desde que empezó la automatización";
        return skip(`Alguien del equipo ya le escribió por WhatsApp ${when}: no se mandó.`, { contact_id: contactId, team_wrote: true });
      }
    }
  }

  // 5. Nunca dos veces: la reserva (sesión + paso + número) va ANTES de mandar y de pedir lugar en el tope.
  const { error: claimError } = await supabase.from("flow_send_claims").insert({
    workspace_id: context.workspaceId,
    session_id: sessionId,
    node_id: node.id,
    target: phone,
  });
  if (claimError) {
    if (claimError.code === "23505") return skip("Este paso ya le mandó un mensaje a ese número en esta ejecución.", { duplicate: true });
    return skip("No pude reservar el envío, así que no se mandó.", { error: claimError.message.slice(0, 200) });
  }

  // 6. El tope por hora del canal. Si la función falla (no por tope, sino por un error), se deja pasar: es lo que hace el resto del motor.
  const { data: allowed, error: capError } = await supabase.rpc("claim_automated_send", { p_channel_id: channel.id, p_limit: WHATSAPP_HOURLY_LIMIT });
  if (capError) console.error("[flow-engine] no pude reclamar el envío de WhatsApp, dejo pasar:", capError.message);
  else if (allowed === false) return skip("El canal llegó al tope de mensajes automáticos de la hora: no se mandó.", { rate_limited: true });

  // 7. Mandar.
  const message = { text, ...(mediaUrl ? { mediaUrl, mediaType: data.mediaType || "image" } : {}) };
  const recordInHistory = async (ok: boolean, detail: string | null): Promise<void> => {
    try {
      await supabase.from("analytics_events").insert({
        workspace_id: context.workspaceId,
        flow_id: context.flowId,
        contact_id: contactId,
        event_type: ok ? "whatsapp_number_sent" : "whatsapp_number_failed",
        metadata: { nodeId: node.id, to: phone, text: text.slice(0, MAX_TEXT_IN_HISTORY), result: ok ? "sent" : "failed", ...(detail ? { detail } : {}), channelId: channel.id },
      });
    } catch (err) {
      console.error("[flow-engine] no pude anotar el envío de WhatsApp en el historial:", err instanceof Error ? err.message : String(err));
    }
  };

  // 7a. Es de un contacto con conversación en este canal: sale como cualquier envío y queda en su conversación.
  if (contactId && conversationId) {
    const sendContext = { workspaceId: context.workspaceId, channelId: channel.id, contactId, conversationId, flowId: context.flowId, nodeId: node.id, origin: "flow" as const };
    const outcome = await sendChannelMessage(supabase, sendContext, message);
    await recordSend(supabase, sendContext, outcome.ok ? text : outcome.failure?.message ?? text, outcome);
    if (!outcome.ok) context.noteStep?.({ status: "failed", reason: outcome.failure?.message ?? "No se pudo mandar el mensaje." });
    await recordInHistory(outcome.ok, outcome.ok ? null : (outcome.failure?.message ?? null));
    return;
  }

  // 7b. No es de nadie (o no tiene conversación acá): se manda sin crear contacto ni conversación.
  const config = await getEvolutionConfig(supabase, context.workspaceId);
  if (!config) {
    await recordInHistory(false, "WhatsApp no está configurado en este entorno.");
    return skip("WhatsApp no está configurado en este entorno.");
  }
  const outcome = await sendEvolutionDirect(supabase, config, channel.evolution_instance, phone, message, { client: supabase, channelId: channel.id });
  if (!outcome.ok) context.noteStep?.({ status: "failed", reason: outcome.failure?.message ?? "No se pudo mandar el mensaje." });
  await recordInHistory(outcome.ok, outcome.ok ? null : (outcome.failure?.message ?? null));
}

export const sendWhatsAppNumberNode: NodeDefinition<SendWhatsAppNumberData> = {
  needsContact: false,
  requires: ["whatsapp_channel"],
  type: SEND_WHATSAPP_NUMBER_TYPE,
  label: "Enviar WhatsApp a un número",
  aliases: [{ nodeType: "action", actionType: SEND_WHATSAPP_NUMBER_TYPE }],
  execute,
};
