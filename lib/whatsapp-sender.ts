/**
 * Quien es la otra persona de un mensaje de WhatsApp (Evolution / Baileys).
 *
 * WhatsApp ya no siempre comparte el telefono: a veces identifica a la persona con
 * un `@lid` (un id interno) en vez de `<numero>@s.whatsapp.net`. Evolution 2.3.7
 * cambia el `@lid` por el telefono antes de avisarnos cuando LO SABE
 * (`key.remoteJidAlt`); si nos llega un `@lid`, es porque nadie sabe el numero.
 *
 * Hasta el 30/10/2026 el receptor DESCARTABA esos mensajes ("sin telefono
 * utilizable"): la conversacion se veia en el celular y nunca entraba al sistema.
 * Ahora la identidad es el telefono si lo hay y, si no, el `@lid`, que tambien
 * sirve para contestar.
 *
 * Puro: sin base ni red.
 */

import { isGroupJid, isLidJid, jidToPhone, normalizeLidJid } from "@/lib/phone";

export interface WhatsappSender {
  /**
   * La identidad en el canal (`contact_channels.platform_sender_id`): el telefono
   * ("+549...") o, si no hay, el @lid ("987...@lid"). Es tambien a donde se contesta.
   */
  id: string;
  /** El telefono normalizado, si se conoce. */
  phone: string | null;
  /** El @lid, si vino alguno. */
  lid: string | null;
}

/** La forma de `key` que mandan Evolution y Baileys segun la version. */
export interface WhatsappMessageKey {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  senderPn?: string | null;
  senderLid?: string | null;
  participantPn?: string | null;
  participantAlt?: string | null;
  [k: string]: unknown;
}

/** Lo que nunca es una persona: grupos, estados, canales y difusiones. */
function isNotAPerson(jid: string): boolean {
  return (
    isGroupJid(jid) ||
    jid === "status@broadcast" ||
    jid.endsWith("@broadcast") ||
    jid.endsWith("@newsletter")
  );
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * La identidad de la otra persona de un mensaje. null si no es una conversacion
 * con una persona (un grupo, un estado, un canal) o si no trae nada utilizable.
 *
 * El telefono sale del `remoteJid` o, si este es un @lid, de los campos donde cada
 * version manda el numero real (`remoteJidAlt`, `senderPn`, `participantPn`,
 * `participantAlt`). Un @lid sale del `remoteJid` o de `senderLid`.
 */
export function resolveWhatsappSender(key: WhatsappMessageKey | null | undefined): WhatsappSender | null {
  const remoteJid = asString(key?.remoteJid);
  if (!remoteJid || isNotAPerson(remoteJid)) return null;

  const phoneCandidates = [remoteJid, key?.remoteJidAlt, key?.senderPn, key?.participantPn, key?.participantAlt];
  let phone: string | null = null;
  for (const candidate of phoneCandidates) {
    const jid = asString(candidate);
    if (!jid || isLidJid(jid) || isNotAPerson(jid)) continue;
    phone = jidToPhone(jid);
    if (phone) break;
  }

  const lid = normalizeLidJid(remoteJid) ?? normalizeLidJid(asString(key?.senderLid)) ?? normalizeLidJid(asString(key?.remoteJidAlt));

  const id = phone ?? lid;
  return id ? { id, phone, lid } : null;
}
