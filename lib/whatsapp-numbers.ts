/**
 * Varios numeros de WhatsApp en un mismo workspace.
 *
 * Cada numero es una instancia de Evolution y una fila de `channels` (provider `evolution`). Hasta ahora el nombre
 * de la instancia salia solo del workspace, asi que habia UNA. Aca se decide como se nombra cada instancia nueva y
 * como se llama el canal en la bandeja ("WhatsApp +54 9 11...").
 *
 * Modulo PURO: lo usan la ruta que conecta, el receptor del webhook y los tests.
 */

/** Tope de numeros por workspace: frena una instancia nueva por cada clic repetido. */
export const MAX_WHATSAPP_NUMBERS = 10;

/**
 * El nombre de la instancia de un numero NUEVO. El primero conserva el nombre de siempre (`<prefijo>-<workspace>`),
 * asi un workspace que ya tiene su numero no cambia; los siguientes llevan un sufijo corto y propio.
 * Lleva siempre el prefijo del proyecto: `deleteInstance` se niega a borrar una instancia que no lo tenga.
 */
export function instanceNameForNumber(params: { prefix: string; workspaceId: string; existingCount: number; suffix: string }): string {
  const base = `${params.prefix}-${params.workspaceId.slice(0, 8)}`;
  if (params.existingCount === 0) return base;
  const suffix = params.suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
  return suffix ? `${base}-${suffix}` : base;
}

/** Un sufijo corto al azar para el nombre de la instancia. */
export function randomInstanceSuffix(random: () => number = Math.random): string {
  let out = "";
  while (out.length < 6) out += Math.floor(random() * 36).toString(36);
  return out;
}

/** El telefono de un JID de WhatsApp ("5491122334455:12@s.whatsapp.net" -> "5491122334455"), o null. */
export function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== "string") return null;
  const digits = (jid.split("@")[0] ?? "").split(":")[0]?.replace(/\D/g, "") ?? "";
  return digits.length >= 6 ? digits : null;
}

/** El nombre del canal mientras todavia no se conoce el numero: "WhatsApp", "WhatsApp 2", "WhatsApp 3"... */
export function pendingWhatsappName(existingCount: number): string {
  return existingCount <= 0 ? "WhatsApp" : `WhatsApp ${existingCount + 1}`;
}

/** El nombre del canal una vez vinculado: "WhatsApp +5491122334455". */
export function numberedWhatsappName(phone: string): string {
  return `WhatsApp +${phone}`;
}

/**
 * Si el nombre del canal lo puso el sistema ("WhatsApp", "WhatsApp 2", "WhatsApp +549...") y por eso se puede
 * reemplazar por el numero. Un nombre que otra persona escribio no se toca.
 */
export function isAutoWhatsappName(name: string | null | undefined): boolean {
  const value = (name ?? "").trim();
  return value === "" || /^WhatsApp( \d+| \+\d+)?$/.test(value);
}

/** Si hay que reescribir el nombre del canal con el numero recien conocido. */
export function nextWhatsappName(current: string | null | undefined, phone: string | null): string | null {
  if (!phone) return null;
  const next = numberedWhatsappName(phone);
  if (!isAutoWhatsappName(current) || (current ?? "").trim() === next) return null;
  return next;
}
