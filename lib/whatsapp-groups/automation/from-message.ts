/**
 * «Crear automatización» desde un mensaje de un grupo (bandeja → «⋯» del mensaje). PURO.
 *
 * Arma el disparador ya configurado: el grupo, ESE mensaje (o esa encuesta), y los emojis u opciones elegidos.
 * La automatizacion nace en borrador; la persona agrega los pasos y la publica.
 */

import type { GroupTriggerType } from "./payload";
import { normalizeEmoji } from "./trigger-config";

export interface FromMessageInput {
  kind: "reaction" | "poll_vote";
  groupId: string;
  messageId: string;
  emojis?: string[];
  options?: string[];
}

const MAX_NAME = 80;

export function automationFromMessage(input: FromMessageInput, labels: { groupName: string; messageLabel: string }): {
  name: string;
  triggerType: GroupTriggerType;
  nodes: Array<{ id: string; type: "trigger"; position: { x: number; y: number }; data: Record<string, unknown> }>;
} {
  const triggerType: GroupTriggerType = input.kind === "reaction" ? "whatsapp_group_reaction" : "whatsapp_group_poll_vote";
  const emojis = Array.from(new Set((input.emojis ?? []).map(normalizeEmoji).filter(Boolean)));
  const options = Array.from(new Set((input.options ?? []).map((o) => o.trim()).filter(Boolean)));
  const data: Record<string, unknown> = {
    triggerType,
    group_ids: [input.groupId],
    message_scope: "picked",
    message_ids: [input.messageId],
  };
  if (input.kind === "reaction" && emojis.length > 0) data.emojis = emojis;
  if (input.kind === "poll_vote" && options.length > 0) data.options = options;

  const what = input.kind === "reaction" ? "Reacción" : "Voto";
  const raw = `${what} en ${labels.groupName}: ${labels.messageLabel}`.replace(/\s+/g, " ").trim();
  const name = raw.length > MAX_NAME ? `${raw.slice(0, MAX_NAME - 1)}…` : raw;
  return { name, triggerType, nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data }] };
}
