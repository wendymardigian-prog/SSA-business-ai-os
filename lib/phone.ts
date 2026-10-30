/**
 * Telefonos y JIDs de WhatsApp.
 *
 * Un JID es como WhatsApp identifica a alguien: "5491122334455@s.whatsapp.net"
 * para una persona, "...@g.us" para un grupo y "...@lid" para un identificador
 * anonimizado: WhatsApp lo usa cuando no comparte el telefono de la persona
 * (quien oculta su numero o usa nombre de usuario, comunidades, canales). Un
 * @lid no es un telefono, pero SI identifica a la persona: se le puede escribir.
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
 * Un @lid limpio: "98765432101234@lid" (sin el ":12" de un dispositivo). null si
 * no es un @lid o no tiene digitos. Es como se guarda la identidad de WhatsApp de
 * una persona cuya conversacion llega sin telefono.
 */
export function normalizeLidJid(jid: string | null | undefined): string | null {
  if (!jid || !isLidJid(jid)) return null;
  const digits = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return digits.length >= 6 ? `${digits}${LID_SUFFIX}` : null;
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
 *
 * Un @lid viaja ENTERO ("98765432101234@lid"): Evolution lo deja tal cual
 * (`createJid`) y el mensaje le llega a esa persona. Convertirlo a digitos lo
 * mandaria a un numero que no existe.
 */
export function toEvolutionNumber(phoneOrJid: string | null | undefined): string | null {
  if (!phoneOrJid) return null;
  if (isLidJid(phoneOrJid)) return normalizeLidJid(phoneOrJid);
  const phone = phoneOrJid.includes("@") ? jidToPhone(phoneOrJid) : normalizePhone(phoneOrJid);
  return phone ? phone.slice(1) : null;
}
