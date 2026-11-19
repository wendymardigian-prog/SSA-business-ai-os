/**
 * Entregar UN envío de la cola de WhatsApp. Solo servidor, con el cliente de servicio. Nunca lanza.
 *
 * Un solo camino por destino, siempre los de siempre:
 *   - conversación → `sendChannelMessage` (la rama por proveedor y el tope único de 200/h del número) y `recordSend` (el
 *     mensaje queda en la conversación con su adjunto, como cualquier envío de una automatización);
 *   - número suelto → `sendEvolutionDirect`, sin crear contacto ni conversación (lo que ya hacía «Enviar WhatsApp a un
 *     número»);
 *   - grupo → `sendToGroup`.
 * Antes de mandar se vuelve a mirar «no contactar» (un contacto marcado no recibe nada automático), que el destino siga
 * existiendo y, si está prendido, el tope por contacto y día. El mensaje se armó al encolar y viaja congelado en
 * `payload`: editar la automatización no lo cambia.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { recordSend, sendChannelMessage, sendEvolutionDirect, type OutboundMessage, type SendContext, type SendOutcome } from "@/lib/flow-engine/send";
import { sendToGroup, type GroupOutbound } from "@/lib/whatsapp-groups/send";
import { getEvolutionConfig } from "@/lib/evolution-config";
import { findContact } from "@/lib/contacts/find-or-create";
import { WHATSAPP_HOURLY_LIMIT } from "@/lib/channels/whatsapp-limits";
import { emptyAttachment, toAttachmentsColumn, type AttachmentKind } from "@/lib/messages/attachments";
import { classifyEvolutionStatus, type SendErrorKind } from "./retry";
import { contactCapDecision, type CapTarget, type ContactCapPolicy } from "./contact-cap";

type Db = SupabaseClient<Database>;
export type QueueItem = Database["public"]["Tables"]["send_queue_items"]["Row"];

export type DeliverOutcome =
  | { kind: "sent"; messageId: string | null }
  | { kind: "failed"; errorKind: SendErrorKind; message: string; laneFatal?: boolean; record?: () => Promise<void> }
  | { kind: "discarded"; code: string; reason: string }
  /** El tope de 200/h del número se llenó con otros envíos: vuelve a la cola sin gastar intento. */
  | { kind: "rate_limited" };

/** Lo que guarda `payload`. */
export interface QueuePayload {
  text?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  groupMedia?: GroupOutbound["media"] | null;
  poll?: GroupOutbound["poll"] | null;
  /** Por WhatsApp los botones y las respuestas rápidas van como lista numerada (lo hace el envío de siempre). */
  buttons?: unknown[] | null;
  quickReplies?: unknown[] | null;
}

export function readPayload(raw: Json): QueuePayload {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as QueuePayload) : {};
}

const VALID_MEDIA_KINDS = new Set<AttachmentKind>(["image", "video", "audio", "voice", "document"]);

function messageOf(p: QueuePayload): OutboundMessage {
  return {
    text: p.text ?? "",
    ...(p.mediaUrl ? { mediaUrl: p.mediaUrl, mediaType: p.mediaType ?? "image" } : {}),
    ...(p.buttons?.length ? { buttons: p.buttons } : {}),
    ...(p.quickReplies?.length ? { quickReplies: p.quickReplies } : {}),
  };
}

/** El adjunto como lo guarda «Enviar mensaje» (formato v2), para que la burbuja lo pinte igual. */
function attachmentsOf(p: QueuePayload): unknown | null {
  if (!p.mediaUrl) return null;
  const kind = VALID_MEDIA_KINDS.has(p.mediaType as AttachmentKind) ? (p.mediaType as AttachmentKind) : "image";
  return toAttachmentsColumn([emptyAttachment(kind, { sourceUrl: p.mediaUrl, status: "ready" })]);
}

/** Transporte o rechazo, mirando lo que dijo el proveedor. Sin vínculo o sin configuración: rechazo (reintentar no lo arregla). */
export function errorKindOf(outcome: Pick<SendOutcome, "failure" | "providerStatus">): SendErrorKind {
  if (outcome.failure?.kind === "user_unavailable" || outcome.failure?.kind === "token_expired") return "rejected";
  return classifyEvolutionStatus(outcome.providerStatus);
}

/** El tope por contacto y día y el comienzo del día del negocio. Sin él, no se mira. */
export interface ContactCapCheck {
  policy: ContactCapPolicy;
  dayStart: string;
}

/**
 * ¿Pasa el tope por contacto (o grupo) de hoy? Un error al contar NO frena el envío (el tope es un freno de cortesía; el
 * cupo del número sigue protegiendo al número), pero se loguea.
 */
async function capBlock(
  service: Db,
  item: QueueItem,
  cap: ContactCapCheck | undefined,
  target: CapTarget,
  who: { contactId?: string | null; groupId?: string | null; phone?: string | null },
): Promise<DeliverOutcome | null> {
  if (!cap || !cap.policy.enabled) return null;
  if (item.priority === "urgent" && !cap.policy.urgentCounts) return null;
  const { data, error } = await service.rpc("send_contact_day_count", {
    p_workspace_id: item.workspace_id,
    p_contact_id: who.contactId ?? null,
    p_group_id: who.groupId ?? null,
    p_phone: who.phone ?? null,
    p_day_start: cap.dayStart,
    p_urgent_counts: cap.policy.urgentCounts,
    p_exclude: item.id,
  });
  if (error) {
    console.error("[send-queue] no pude contar el tope por contacto:", error.message);
    return null;
  }
  const d = contactCapDecision(cap.policy, target, item.priority, typeof data === "number" ? data : 0);
  return d.ok ? null : { kind: "discarded", code: "contact_cap", reason: d.reason };
}

export async function deliverQueueItem(service: Db, item: QueueItem, instance: string | null, cap?: ContactCapCheck): Promise<DeliverOutcome> {
  try {
    const payload = readPayload(item.payload);
    if (item.target_kind === "conversation") return await deliverToConversation(service, item, payload, cap);
    if (item.target_kind === "number") return await deliverToNumber(service, item, payload, instance, cap);
    return await deliverToGroup(service, item, payload, cap);
  } catch (e) {
    return { kind: "failed", errorKind: "transport", message: e instanceof Error ? e.message.slice(0, 300) : "Error inesperado al enviar." };
  }
}

async function deliverToConversation(service: Db, item: QueueItem, payload: QueuePayload, cap?: ContactCapCheck): Promise<DeliverOutcome> {
  if (!item.conversation_id) return { kind: "discarded", code: "no_target", reason: "La conversación ya no existe." };
  const { data: conv, error } = await service.from("conversations").select("id, contact_id, channel_id").eq("id", item.conversation_id).maybeSingle();
  if (error) throw new Error(`No pude leer la conversación: ${error.message}`);
  if (!conv) return { kind: "discarded", code: "no_target", reason: "La conversación ya no existe." };
  const { data: contact, error: contactError } = await service.from("contacts").select("id, deleted_at, do_not_contact, phone").eq("id", conv.contact_id).maybeSingle();
  if (contactError) throw new Error(`No pude leer el contacto: ${contactError.message}`);
  if (!contact || contact.deleted_at) return { kind: "discarded", code: "no_target", reason: "El contacto ya no existe." };
  if (contact.do_not_contact) return { kind: "discarded", code: "do_not_contact", reason: "El contacto está marcado «no contactar»: no se envió." };
  const capped = await capBlock(service, item, cap, "contact", { contactId: contact.id, phone: contact.phone ?? null });
  if (capped) return capped;

  const ctx: SendContext = {
    workspaceId: item.workspace_id,
    channelId: conv.channel_id,
    contactId: conv.contact_id,
    conversationId: conv.id,
    flowId: item.flow_id,
    nodeId: item.node_id,
    origin: "flow",
  };
  const message = messageOf(payload);
  const outcome = await sendChannelMessage(service, ctx, message);
  if (!outcome.ok && outcome.failure?.kind === "rate_limited") return { kind: "rate_limited" };
  const attachments = attachmentsOf(payload);
  if (outcome.ok) {
    await recordSend(service, ctx, message.text, outcome, attachments);
    return { kind: "sent", messageId: outcome.platformMessageId ?? null };
  }
  return {
    kind: "failed",
    errorKind: errorKindOf(outcome),
    message: outcome.failure?.message ?? "WhatsApp no aceptó el mensaje.",
    laneFatal: outcome.failure?.kind === "token_expired",
    // Solo el ÚLTIMO intento deja la burbuja roja en el chat (lo decide quien llama).
    record: () => recordSend(service, ctx, outcome.failure?.message ?? message.text, outcome, attachments),
  };
}

async function deliverToNumber(service: Db, item: QueueItem, payload: QueuePayload, instance: string | null, cap?: ContactCapCheck): Promise<DeliverOutcome> {
  const phone = item.to_number;
  if (!phone) return { kind: "discarded", code: "no_target", reason: "Sin número de destino." };
  // «No contactar»: si el número es de un contacto marcado, no se manda. Un error de la base NO es «no es de nadie».
  const found = await findContact(service, { workspaceId: item.workspace_id, identity: { phone, whatsapp_phone: phone } });
  if (found.contactId) {
    const { data: contact, error } = await service.from("contacts").select("do_not_contact").eq("id", found.contactId).maybeSingle();
    if (error) throw new Error(`No pude leer el contacto: ${error.message}`);
    if (contact?.do_not_contact) return { kind: "discarded", code: "do_not_contact", reason: "El contacto de ese número está marcado «no contactar»: no se envió." };
  }
  const capped = await capBlock(service, item, cap, "contact", { contactId: found.contactId ?? null, phone });
  if (capped) return capped;
  const config = await getEvolutionConfig(service, item.workspace_id);
  if (!config || !instance) return { kind: "failed", errorKind: "rejected", message: "WhatsApp no está configurado en este entorno.", laneFatal: true };
  const { data: allowed, error: capError } = await service.rpc("claim_automated_send", { p_channel_id: item.channel_id, p_limit: WHATSAPP_HOURLY_LIMIT });
  if (capError) console.error("[send-queue] no pude reclamar el envío del número, dejo pasar:", capError.message);
  else if (allowed === false) return { kind: "rate_limited" };
  // Lane null: el turno del carril ya lo tomó la cola (`claim_lane_slot_at`).
  const outcome = await sendEvolutionDirect(service, config, instance, phone, messageOf(payload), null);
  const { error: historyError } = await service.from("analytics_events").insert({
    workspace_id: item.workspace_id,
    flow_id: item.flow_id,
    contact_id: found.contactId ?? null,
    event_type: outcome.ok ? "whatsapp_number_sent" : "whatsapp_number_failed",
    metadata: {
      nodeId: item.node_id,
      to: phone,
      text: (payload.text ?? "").slice(0, 500),
      result: outcome.ok ? "sent" : "failed",
      ...(outcome.ok ? {} : { detail: outcome.failure?.message ?? null }),
      channelId: item.channel_id,
      queueItemId: item.id,
    },
  });
  if (historyError) console.error("[send-queue] no pude anotar el envío en el historial:", historyError.message);
  if (outcome.ok) return { kind: "sent", messageId: outcome.platformMessageId ?? null };
  return { kind: "failed", errorKind: errorKindOf(outcome), message: outcome.failure?.message ?? "WhatsApp no aceptó el mensaje." };
}

async function deliverToGroup(service: Db, item: QueueItem, payload: QueuePayload, cap?: ContactCapCheck): Promise<DeliverOutcome> {
  if (!item.whatsapp_group_id) return { kind: "discarded", code: "no_target", reason: "El grupo ya no existe." };
  const { data: group, error } = await service
    .from("whatsapp_groups")
    .select("id, workspace_id, channel_id, group_jid, left_at")
    .eq("id", item.whatsapp_group_id)
    .eq("workspace_id", item.workspace_id)
    .maybeSingle();
  if (error) throw new Error(`No pude leer el grupo: ${error.message}`);
  if (!group || group.left_at) return { kind: "discarded", code: "no_target", reason: "El grupo ya no existe o el número salió de él." };
  const capped = await capBlock(service, item, cap, "group", { groupId: group.id });
  if (capped) return capped;
  const { data: allowed, error: capError } = await service.rpc("claim_automated_send", { p_channel_id: group.channel_id, p_limit: WHATSAPP_HOURLY_LIMIT });
  if (capError) console.error("[send-queue] no pude reclamar el envío al grupo, dejo pasar:", capError.message);
  else if (allowed === false) return { kind: "rate_limited" };
  const result = await sendToGroup(
    service,
    group,
    { text: payload.text ?? null, media: payload.groupMedia ?? null, poll: payload.poll ?? null },
    { userId: null, flowId: item.flow_id, nodeId: item.node_id },
  );
  if (result.ok) return { kind: "sent", messageId: result.messageId };
  return { kind: "failed", errorKind: classifyEvolutionStatus(result.status), message: result.error };
}
