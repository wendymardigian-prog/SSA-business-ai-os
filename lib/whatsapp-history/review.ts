/**
 * La revision del historial de WhatsApp guardado en Evolution (30/10/2026).
 *
 * Antes de importar nada se mira que hay: cuantos chats con personas guarda el
 * Evolution del cliente, cuantos de esos no estan en la bandeja, cuantos mensajes y
 * desde cuando. Evolution guarda lo que WhatsApp le mando al escanear el QR (si su
 * `DATABASE_SAVE_DATA_HISTORIC` esta prendido) y lo que recibio desde entonces.
 *
 * Esta parte es PURA: recibe lo que devolvio Evolution y lo que ya esta en la
 * bandeja, y arma el resumen. La lectura vive en `./run-review.ts`.
 */

import { resolveWhatsappSender } from "@/lib/whatsapp-sender";
import { isGroupJid } from "@/lib/phone";
import type { EvolutionStoredChat } from "@/lib/evolution-client";

export interface HistoryReview {
  /** Chats con personas (sin grupos, estados ni canales). */
  people: number;
  /** De esos, cuantos son de alguien que no compartio su numero (@lid). */
  peopleWithoutNumber: number;
  /** De esos, cuantos NO tienen conversacion en la bandeja: lo que traeria una importacion. */
  missingInInbox: number;
  /** Grupos: no se importan (no son un lead). */
  groups: number;
  /** Si se corto en el tope de chats leidos (hay mas que estos). */
  truncated: boolean;
  /** Mensajes guardados en Evolution (incluye los de grupos). */
  messages: number;
  /** El mensaje mas viejo y el mas nuevo guardados, en ISO. null si no hay. */
  oldestMessageAt: string | null;
  newestMessageAt: string | null;
  /** Si hay mensajes de ANTES de conectar el numero al sistema: o sea, historial para traer. */
  hasHistoryBeforeConnection: boolean;
}

/** Un timestamp de WhatsApp (segundos, a veces como texto) en ISO. */
export function whatsappTimestampToIso(value: number | string | null | undefined): string | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  // Segundos (lo normal) o milisegundos (algunas versiones).
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
}

/** Las identidades (telefono o @lid) de los chats con personas, para cruzarlas con la bandeja. */
export function peopleSenderIds(chats: EvolutionStoredChat[]): string[] {
  const ids = new Set<string>();
  for (const chat of chats) {
    const sender = resolveWhatsappSender({ remoteJid: chat.remoteJid ?? null });
    if (sender) ids.add(sender.id);
  }
  return [...ids];
}

export function summarizeHistory(input: {
  chats: EvolutionStoredChat[];
  take: number;
  /** Las identidades que YA tienen conversacion en este canal. */
  knownSenderIds: Set<string>;
  totalMessages: number;
  oldestMessageAt: string | null;
  newestMessageAt: string | null;
  /** Cuando se conecto el numero al sistema (`channels.created_at`). */
  connectedAt: string;
}): HistoryReview {
  let people = 0;
  let peopleWithoutNumber = 0;
  let missingInInbox = 0;
  let groups = 0;
  const seen = new Set<string>();

  for (const chat of input.chats) {
    const jid = chat.remoteJid ?? "";
    if (isGroupJid(jid)) {
      groups += 1;
      continue;
    }
    const sender = resolveWhatsappSender({ remoteJid: jid });
    if (!sender || seen.has(sender.id)) continue;
    seen.add(sender.id);
    people += 1;
    if (!sender.phone) peopleWithoutNumber += 1;
    if (!input.knownSenderIds.has(sender.id)) missingInInbox += 1;
  }

  return {
    people,
    peopleWithoutNumber,
    missingInInbox,
    groups,
    truncated: input.chats.length >= input.take,
    messages: input.totalMessages,
    oldestMessageAt: input.oldestMessageAt,
    newestMessageAt: input.newestMessageAt,
    hasHistoryBeforeConnection:
      input.oldestMessageAt !== null && input.oldestMessageAt < new Date(input.connectedAt).toISOString(),
  };
}
