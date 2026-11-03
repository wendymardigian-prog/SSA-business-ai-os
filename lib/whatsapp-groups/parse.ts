/**
 * Lo que manda Evolution sobre un grupo de WhatsApp, entendido.
 *
 * Dos formas de aviso:
 *   - `group-participants.update`: alguien entro, salio, o cambio de admin. Baileys v7 manda cada
 *     participante como OBJETO `{ id, phoneNumber?, lid?, admin }`: `id` puede ser el telefono o el @lid, y el
 *     otro dato viene al lado cuando WhatsApp lo comparte. (Evolution 2.3.7 suma un `participantsData` que viene
 *     roto — cada telefono sale "[object Object]" — y por eso no se usa.) Unirse por un link de invitacion
 *     tambien llega como `add`.
 *   - `messages.upsert` con `key.remoteJid` = el grupo: quien escribio va en `key.participant` (telefono o @lid)
 *     y, segun la version, el otro dato en `participantAlt` / `participantPn`.
 *
 * La identidad de una persona es la MISMA que en un chat privado (`resolveWhatsappSender`): el telefono si lo hay
 * y, si no, el @lid. Asi el contacto de alguien que entro a un grupo y despues escribe por privado es uno solo.
 *
 * Modulo PURO: sin base ni red.
 */

import { normalizeGroupJid } from "@/lib/phone";
import { resolveWhatsappSender, type WhatsappSender } from "@/lib/whatsapp-sender";

export type GroupParticipantsAction = "add" | "remove" | "promote" | "demote";

export interface GroupParticipantsEvent {
  groupJid: string;
  action: GroupParticipantsAction;
  participants: WhatsappSender[];
}

const ACTIONS = new Set<string>(["add", "remove", "promote", "demote"]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * La identidad de un participante. Acepta el objeto de Baileys v7 o, por las dudas, un JID suelto (como lo
 * mandaban versiones anteriores). null si no trae nada utilizable.
 */
export function participantIdentity(raw: unknown): WhatsappSender | null {
  if (typeof raw === "string") return resolveWhatsappSender({ remoteJid: raw });
  if (!raw || typeof raw !== "object") return null;
  const p = raw as { id?: unknown; phoneNumber?: unknown; lid?: unknown; jid?: unknown };
  const id = str(p.id) ?? str(p.jid);
  if (!id) return null;
  return resolveWhatsappSender({ remoteJid: id, remoteJidAlt: str(p.phoneNumber), senderLid: str(p.lid) });
}

/** El aviso de miembros de un grupo, o null si no se entiende. */
export function parseGroupParticipantsEvent(data: unknown): GroupParticipantsEvent | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { id?: unknown; action?: unknown; participants?: unknown };
  const groupJid = normalizeGroupJid(str(d.id));
  const action = str(d.action);
  if (!groupJid || !action || !ACTIONS.has(action)) return null;

  const seen = new Set<string>();
  const participants: WhatsappSender[] = [];
  for (const raw of Array.isArray(d.participants) ? d.participants : []) {
    const identity = participantIdentity(raw);
    if (!identity || seen.has(identity.id)) continue;
    seen.add(identity.id);
    participants.push(identity);
  }
  return { groupJid, action: action as GroupParticipantsAction, participants };
}

/** La forma de `key` de un mensaje de grupo. */
export interface GroupMessageKey {
  remoteJid?: string | null;
  fromMe?: boolean;
  id?: string | null;
  participant?: string | null;
  participantAlt?: string | null;
  participantPn?: string | null;
  participantLid?: string | null;
  [k: string]: unknown;
}

/** El JID del grupo de un mensaje, o null si el mensaje no es de un grupo. */
export function groupJidOfMessage(key: GroupMessageKey | null | undefined): string | null {
  return normalizeGroupJid(str(key?.remoteJid));
}

/** Quien escribio un mensaje en un grupo (o reacciono, o voto). null si no se sabe. */
export function groupMessageSender(key: GroupMessageKey | null | undefined): WhatsappSender | null {
  const participant = str(key?.participant);
  if (!participant) return null;
  return resolveWhatsappSender({
    remoteJid: participant,
    remoteJidAlt: str(key?.participantAlt),
    participantPn: str(key?.participantPn),
    senderLid: str(key?.participantLid),
  });
}

export interface ParsedPoll {
  name: string;
  options: string[];
  /** 0 = se pueden elegir todas. */
  selectableCount: number;
}

/** La encuesta que trae un mensaje de Baileys (las tres versiones de `pollCreationMessage`), o null. */
export function parsePollCreation(message: unknown): ParsedPoll | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  const node = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3;
  if (!node || typeof node !== "object") return null;
  const n = node as { name?: unknown; options?: unknown; selectableOptionsCount?: unknown };
  const name = str(n.name);
  if (!name) return null;
  const options: string[] = [];
  for (const option of Array.isArray(n.options) ? n.options : []) {
    const optionName = option && typeof option === "object" ? str((option as { optionName?: unknown }).optionName) : null;
    if (optionName && !options.includes(optionName)) options.push(optionName);
  }
  const count = typeof n.selectableOptionsCount === "number" && n.selectableOptionsCount > 0 ? Math.floor(n.selectableOptionsCount) : 0;
  return { name, options, selectableCount: count };
}

/** Como se ve el voto en una linea: "Lunes, Martes". */
export function selectedOptionsText(options: readonly string[]): string {
  return options.join(", ");
}
