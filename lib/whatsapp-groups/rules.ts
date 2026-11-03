/**
 * Reglas chicas de los grupos de WhatsApp. Modulo PURO.
 */

import { normalizePhone } from "@/lib/phone";
import type { WhatsappSender } from "@/lib/whatsapp-sender";

/**
 * La carpeta de la media de un grupo dentro del bucket `chat-media`: `<workspace>/groups/<grupo>/...`. El primer
 * segmento sigue siendo el workspace, que es lo unico que mira la policy del bucket.
 */
export function groupMediaFolder(groupId: string): string {
  return `groups/${groupId}`;
}

/** El telefono del propio numero, sacado del nombre del canal ("WhatsApp +5491122334455"), o null. */
export function ownPhoneOf(channel: { display_name?: string | null; username?: string | null }): string | null {
  for (const text of [channel.display_name, channel.username]) {
    const match = text?.match(/\+?\d[\d\s-]{7,}\d/);
    const phone = match ? normalizePhone(match[0]) : null;
    if (phone) return phone;
  }
  return null;
}

/** Si el participante es el propio numero del negocio (entrar a un grupo no lo vuelve un contacto). */
export function isOwnParticipant(channel: { display_name?: string | null; username?: string | null }, participant: WhatsappSender): boolean {
  const own = ownPhoneOf(channel);
  return !!own && participant.phone === own;
}

/** Las claves con las que puede estar guardado un miembro (su identidad, su telefono o su @lid). */
export function participantKeyOf(participant: WhatsappSender): string[] {
  return Array.from(new Set([participant.id, participant.phone, participant.lid].filter((v): v is string => !!v)));
}
