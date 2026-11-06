/**
 * Que se importa de un chat de WhatsApp guardado en Evolution.
 *
 * Es PURO: recibe el chat y sus mensajes, y decide quien es la persona, como se
 * llama y que mensajes entran. Lo escribe `./run-import.ts`.
 *
 * La identidad sale del chat ENTERO y no de cada mensaje: en un chat con @lid
 * algunos mensajes pueden traer el telefono y otros no, y mirarlos de a uno
 * partiria a la misma persona en dos contactos.
 */

import type { EvolutionStoredChat, EvolutionStoredMessage } from "@/lib/evolution-client";
import { fromBaileysMessage, toAttachmentsColumn, unwrapBaileysMessage } from "@/lib/messages/attachments";
import { extractText } from "@/lib/evolution-message";
import { isPlaceholderName } from "@/lib/contacts/anonymous";
import { parseBaileysReaction } from "@/lib/messages/reactions-inbound";
import { parseBaileysPollVote } from "@/lib/messages/poll-votes";
import { previewForMessage } from "@/lib/message-preview";
import { resolveWhatsappSender, type WhatsappSender } from "@/lib/whatsapp-sender";
import { whatsappTimestampToIso } from "./review";

/** Sin movimiento hace mas que esto, la conversacion nace cerrada: no llena «Esperando respuesta». */
export const IMPORT_OPEN_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** El nombre de un contacto del que no sabemos ni el nombre ni el numero (igual que el receptor). */
const UNKNOWN_NAME = "Contacto de WhatsApp";

export interface ImportedMessage {
  platformMessageId: string;
  direction: "inbound" | "outbound";
  text: string | null;
  attachments: unknown;
  createdAt: string;
}

export interface ChatImportPlan {
  sender: WhatsappSender;
  name: string;
  /** Los mensajes, del mas viejo al mas nuevo. */
  messages: ImportedMessage[];
  lastAt: string;
  preview: string;
}

/**
 * Un mensaje guardado como fila de historial. null si no es algo que una persona
 * dijo: reacciones, votos, avisos de protocolo, o sin id o sin fecha.
 *
 * El archivo de un adjunto NO se trae: WhatsApp suele haberlo borrado y pedir todos
 * los viejos a la vez es caro. Queda `none` (la burbuja dice que tipo era), porque
 * `pending` dejaria el spinner girando para siempre: nadie lo va a bajar.
 */
export function historicMessageFrom(record: EvolutionStoredMessage): ImportedMessage | null {
  const id = record.key?.id;
  const createdAt = whatsappTimestampToIso(record.messageTimestamp);
  if (!id || !createdAt || !record.message) return null;
  if (parseBaileysReaction(record.message) || parseBaileysPollVote(record.message)) return null;

  const text = extractText(unwrapBaileysMessage(record.message));
  const items = fromBaileysMessage(record.message).map((item) =>
    item.status === "pending" ? { ...item, status: "none" as const } : item,
  );
  if (!text && items.length === 0) return null;

  return {
    platformMessageId: id,
    direction: record.key?.fromMe === true ? "outbound" : "inbound",
    text,
    attachments: toAttachmentsColumn(items),
    createdAt,
  };
}

/** null si el chat no es con una persona o no tiene ningun mensaje real: no crea un contacto vacio. */
export function planChatImport(chat: EvolutionStoredChat, records: EvolutionStoredMessage[]): ChatImportPlan | null {
  const chatSender = resolveWhatsappSender({ remoteJid: chat.remoteJid ?? null });
  if (!chatSender) return null;

  const byId = new Map<string, ImportedMessage>();
  for (const record of records) {
    const message = historicMessageFrom(record);
    if (message) byId.set(message.platformMessageId, message);
  }
  const messages = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const last = messages.at(-1);
  if (!last) return null;

  // El telefono puede estar en cualquier mensaje del chat, aunque el chat sea un @lid.
  let sender = chatSender;
  if (!sender.phone) {
    for (const record of records) {
      const candidate = resolveWhatsappSender({ ...record.key, remoteJid: chat.remoteJid ?? null });
      if (candidate?.phone) {
        sender = candidate;
        break;
      }
    }
  }

  return {
    sender,
    name: chatName(chat, records, sender),
    messages,
    lastAt: last.createdAt,
    preview: previewForMessage({ text: last.text, attachments: last.attachments }),
  };
}

/**
 * El nombre del perfil, del mensaje mas nuevo que escribio la persona. Dos trampas:
 * en un mensaje que mandamos nosotros `pushName` es NUESTRO nombre (por eso el del
 * chat solo se usa si el ultimo mensaje no fue nuestro), y cuando Evolution no conoce
 * el nombre guarda los digitos del chat, que no son un nombre.
 */
function chatName(chat: EvolutionStoredChat, records: EvolutionStoredMessage[], sender: WhatsappSender): string {
  const realName = (value: string | null | undefined) => {
    const name = value?.trim();
    return name && !isPlaceholderName(name) ? name : null;
  };
  const newestFirst = [...records].sort(
    (a, b) => (whatsappTimestampToIso(b.messageTimestamp) ?? "").localeCompare(whatsappTimestampToIso(a.messageTimestamp) ?? ""),
  );
  for (const record of newestFirst) {
    const name = record.key?.fromMe === true ? null : realName(record.pushName);
    if (name) return name;
  }
  const chatPushName = chat.lastMessage?.key?.fromMe === true ? null : realName(chat.pushName);
  return chatPushName ?? sender.phone ?? UNKNOWN_NAME;
}

/** Abierta si tuvo movimiento en la ultima semana. */
export function importedConversationStatus(lastAt: string, now: Date): "open" | "closed" {
  return now.getTime() - new Date(lastAt).getTime() > IMPORT_OPEN_WINDOW_MS ? "closed" : "open";
}
