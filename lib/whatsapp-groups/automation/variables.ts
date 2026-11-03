/**
 * Las variables que un flujo de grupo puede usar (`{{group.name}}`, `{{reaction.emoji}}`…). PURO.
 */

import type { GroupTriggerType } from "./payload";

export interface GroupVariableField {
  path: string;
  label: string;
}

const GROUP_FIELDS: GroupVariableField[] = [
  { path: "group.name", label: "Nombre del grupo" },
  { path: "group.id", label: "Id del grupo" },
];
const MESSAGE_FIELDS: GroupVariableField[] = [{ path: "message.text", label: "Texto del mensaje" }];

export function groupVariableFields(type: GroupTriggerType): GroupVariableField[] {
  switch (type) {
    case "whatsapp_group_joined":
      return [...GROUP_FIELDS];
    case "whatsapp_group_reaction":
      return [...GROUP_FIELDS, { path: "reaction.emoji", label: "Emoji de la reacción" }, ...MESSAGE_FIELDS];
    case "whatsapp_group_poll_vote":
      return [
        ...GROUP_FIELDS,
        { path: "poll.question", label: "Pregunta de la encuesta" },
        { path: "poll.selected", label: "Opciones que eligió" },
      ];
  }
}

const text = (payload: Record<string, unknown>, key: string): string => {
  const v = payload[key];
  return typeof v === "string" ? v : "";
};

/** Las variables a partir del payload del evento. */
export function groupVariables(type: GroupTriggerType, payload: Record<string, unknown>): Record<string, unknown> {
  const vars: Record<string, unknown> = { group: { name: text(payload, "group_name"), id: text(payload, "group_id") } };
  if (type === "whatsapp_group_reaction") {
    vars.reaction = { emoji: text(payload, "emoji") };
    vars.message = { text: text(payload, "message_text") };
  }
  if (type === "whatsapp_group_poll_vote") {
    vars.poll = { question: text(payload, "poll_question"), selected: text(payload, "selected") };
  }
  return vars;
}
