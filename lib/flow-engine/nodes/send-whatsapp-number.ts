/**
 * «Enviar WhatsApp a un número» (Extra L, Tirón 2, D3): un aviso a un número que puede no ser de ningún contacto
 * (por ejemplo, el aviso a la dueña cuando entra un lead por un webhook). No necesita contacto: `needsContact: false`.
 *
 * Es un paso APARTE y no una opción de «Enviar mensaje» a propósito: «Enviar mensaje» sigue intacto (cero riesgo para los
 * flujos que ya existen) y este paso tiene sus propias reglas, que son distintas:
 *
 *   - El destino es un número fijo o el de una variable (`{{webhook.body.telefono}}`), normalizado con `lib/phone.ts`.
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
import type { NodeDefinition, NodeExecutionArgs } from "../registry/types";
import { interpolateVariables } from "../interpolate";
import { resolveWhatsAppTarget } from "../whatsapp-target";
import { recordSend, sendChannelMessage, sendEvolutionDirect } from "../send";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { findContact } from "@/lib/contacts/find-or-create";

export interface SendWhatsAppNumberData {
  to?: "fixed" | "variable";
  /** Solo `to: "fixed"`: el número tal como lo escribió la persona. */
  fixedPhone?: string;
  /** Solo `to: "variable"`: `{{webhook.body.telefono}}` (también se acepta sin las llaves). */
  toVariable?: string;
  /** El canal de WhatsApp que manda. Obligatorio. */
  channelId?: string;
  text?: string;
  /** Un archivo por URL pública, como «Enviar mensaje». */
  mediaUrl?: string;
  mediaType?: string;
}

/** Tope de mensajes automáticos por hora y canal (el mismo que usa el resto del motor). */
export const WHATSAPP_NUMBER_HOURLY_LIMIT = 200;

export const SEND_WHATSAPP_NUMBER_TYPE = "send_whatsapp_number";

const MAX_TEXT_IN_HISTORY = 500;

export { resolveWhatsAppTarget, hasUnresolvedVariable, type TargetResolution } from "../whatsapp-target";

async function execute({ supabase, data, context, node, sessionId }: NodeExecutionArgs<SendWhatsAppNumberData, FlowExecutionContext>): Promise<void> {
  const label = typeof (node.data as { label?: unknown } | undefined)?.label === "string" && String((node.data as { label?: string }).label).trim()
    ? String((node.data as { label?: string }).label).trim()
    : "Enviar WhatsApp a un número";

  /** Saltea el paso con el motivo: se anota en el historial del flujo y en el del envío del webhook. Nunca lanza. */
  const skip = async (reason: string, extra: Record<string, unknown> = {}): Promise<void> => {
    console.warn(`[flow-engine] el nodo ${node.id} (${SEND_WHATSAPP_NUMBER_TYPE}) se saltea: ${reason}`);
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
  const { data: allowed, error: capError } = await supabase.rpc("claim_automated_send", { p_channel_id: channel.id, p_limit: WHATSAPP_NUMBER_HOURLY_LIMIT });
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
    await recordInHistory(outcome.ok, outcome.ok ? null : (outcome.failure?.message ?? null));
    return;
  }

  // 7b. No es de nadie (o no tiene conversación acá): se manda sin crear contacto ni conversación.
  const config = await getEvolutionConfig(supabase, context.workspaceId);
  if (!config) {
    await recordInHistory(false, "WhatsApp no está configurado en este entorno.");
    return skip("WhatsApp no está configurado en este entorno.");
  }
  const outcome = await sendEvolutionDirect(supabase, config, channel.evolution_instance, phone, message);
  await recordInHistory(outcome.ok, outcome.ok ? null : (outcome.failure?.message ?? null));
}

export const sendWhatsAppNumberNode: NodeDefinition<SendWhatsAppNumberData> = {
  needsContact: false,
  type: SEND_WHATSAPP_NUMBER_TYPE,
  label: "Enviar WhatsApp a un número",
  aliases: [{ nodeType: "action", actionType: SEND_WHATSAPP_NUMBER_TYPE }],
  execute,
};
