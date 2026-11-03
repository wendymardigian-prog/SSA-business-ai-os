/**
 * Los eventos de automatizacion de los grupos de WhatsApp: tipos y payloads.
 *
 * Tres eventos, los tres de CONTACTO (el flujo corre sobre la persona):
 *   - whatsapp_group_joined     alguien se unio a un grupo activado
 *   - whatsapp_group_reaction   alguien reacciono a un mensaje del grupo
 *   - whatsapp_group_poll_vote  alguien voto en una encuesta del grupo
 *
 * El payload lleva SOLO escalares (regla de la cola) y nunca `booking_id`. Las opciones elegidas viajan dos veces:
 * como texto para mostrar (`selected`) y como JSON (`selected_options_json`) para que el filtro compare exacto.
 *
 * Modulo PURO.
 */

export const GROUP_TRIGGER_TYPES = ["whatsapp_group_joined", "whatsapp_group_reaction", "whatsapp_group_poll_vote"] as const;
export type GroupTriggerType = (typeof GROUP_TRIGGER_TYPES)[number];

/** El tope del texto de un mensaje en el payload (para variables y condiciones; no es el hilo). */
const MESSAGE_TEXT_MAX = 500;

export interface GroupRef {
  id: string;
  group_jid: string;
  subject: string;
  channel_id: string;
}

export interface GroupMessageRef {
  id: string;
  text: string | null;
  direction: "inbound" | "outbound";
  sent_by_flow_id: string | null;
  sent_by_node_id: string | null;
}

export type GroupEventPayload = Record<string, string | number | boolean | null>;

function base(group: GroupRef, participantId: string): GroupEventPayload {
  return {
    channel_id: group.channel_id,
    group_id: group.id,
    group_jid: group.group_jid,
    group_name: group.subject,
    participant_id: participantId,
  };
}

function messageFields(message: GroupMessageRef): GroupEventPayload {
  const text = (message.text ?? "").trim();
  return {
    message_id: message.id,
    message_text: text.length > MESSAGE_TEXT_MAX ? `${text.slice(0, MESSAGE_TEXT_MAX)}…` : text,
    message_from_business: message.direction === "outbound",
    message_flow_id: message.sent_by_flow_id,
    message_node_id: message.sent_by_node_id,
  };
}

export function joinedPayload(group: GroupRef, participantId: string): GroupEventPayload {
  return base(group, participantId);
}

export function reactionPayload(group: GroupRef, participantId: string, message: GroupMessageRef, emoji: string): GroupEventPayload {
  return { ...base(group, participantId), ...messageFields(message), emoji };
}

export function pollVotePayload(
  group: GroupRef,
  participantId: string,
  message: GroupMessageRef,
  poll: { name: string },
  selected: readonly string[],
): GroupEventPayload {
  return {
    ...base(group, participantId),
    ...messageFields(message),
    poll_question: poll.name,
    selected: selected.join(", "),
    selected_options_json: JSON.stringify(selected),
  };
}

/** Las opciones elegidas de un payload de voto. Ante un dato roto, ninguna. */
export function selectedOptionsOf(payload: Record<string, unknown>): string[] {
  const raw = payload.selected_options_json;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((option): option is string => typeof option === "string") : [];
  } catch {
    return [];
  }
}
