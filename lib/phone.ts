/**
 * Telefonos y JIDs de WhatsApp.
 *
 * Un JID es como WhatsApp identifica a alguien: "5491122334455@s.whatsapp.net"
 * para una persona, "...@g.us" para un grupo y "...@lid" para un identificador
 * anonimizado (WhatsApp lo usa en comunidades y canales; no trae el telefono).
 *
 * El telefono se guarda siempre normalizado como "+<digitos>" para que la
 * deduplicacion cross-canal del Bloque 3 compare manzanas con manzanas.
 */

/** Sufijo de los JID de contactos individuales. */
const INDIVIDUAL_SUFFIX = "@s.whatsapp.net";
const GROUP_SUFFIX = "@g.us";
const LID_SUFFIX = "@lid";

/**
 * Deja el telefono como "+<digitos>". Devuelve null si no queda un numero
 * usable, para no guardar basura que despues rompa la deduplicacion.
 *
 * - Ignora espacios, guiones, parentesis y puntos.
 * - "00" al principio es el prefijo internacional de marcado: equivale a "+".
 * - Menos de 8 digitos no es un numero internacional valido.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let digits = raw.replace(/[^\d+]/g, "");
  digits = digits.replace(/(?!^)\+/g, "");

  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);

  if (!/^\d+$/.test(digits)) return null;
  if (digits.length < 8 || digits.length > 15) return null;

  return `+${digits}`;
}

export function isGroupJid(jid: string | null | undefined): boolean {
  return !!jid && jid.endsWith(GROUP_SUFFIX);
}

/** True para los JID anonimizados, que no traen telefono utilizable. */
export function isLidJid(jid: string | null | undefined): boolean {
  return !!jid && jid.endsWith(LID_SUFFIX);
}

/**
 * Telefono normalizado a partir de un JID. null para grupos, para @lid y para
 * cualquier cosa que no parezca un numero.
 */
export function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid || isGroupJid(jid) || isLidJid(jid)) return null;
  // El JID de un dispositivo secundario viene como "549112233:12@s.whatsapp.net".
  const user = jid.split("@")[0].split(":")[0];
  return normalizePhone(user);
}

/** JID individual a partir de un telefono. null si el telefono no sirve. */
export function phoneToJid(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone);
  return normalized ? `${normalized.slice(1)}${INDIVIDUAL_SUFFIX}` : null;
}

/**
 * Como se manda un numero a Evolution API: solo digitos, sin "+".
 * Acepta tanto un telefono como un JID entero.
 */
export function toEvolutionNumber(phoneOrJid: string | null | undefined): string | null {
  if (!phoneOrJid) return null;
  const phone = phoneOrJid.includes("@") ? jidToPhone(phoneOrJid) : normalizePhone(phoneOrJid);
  return phone ? phone.slice(1) : null;
}
