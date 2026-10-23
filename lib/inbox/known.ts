/**
 * "Conocido" (00256): alguien personal que escribe por la misma cuenta por la
 * que entran los leads. Es una marca del CONTACTO, no una etiqueta.
 *
 * Tres reglas puras:
 *  - `knownAssignee`: a quien va un chat de un conocido. Misma regla que
 *    `private.known_assignee` (00256), que es la que asigna de verdad; esta la
 *    usan la pantalla de Ajustes y los tests (`known.cases.json`).
 *  - `knownGate`: si al abrir el chat hay que mostrar primero el aviso
 *    "Es un conocido de…" (y no marcarlo como leido todavia).
 *  - `parseKnownSettings` / `checkKnownSettings`: la configuracion por cuenta.
 */

export interface KnownSettings {
  byChannel: Record<string, string>;
  defaultUserId: string | null;
}

export const EMPTY_KNOWN_SETTINGS: KnownSettings = { byChannel: {}, defaultUserId: null };

/** Lo guardado en `workspaces.known_contacts_settings`, tolerante a basura. */
export function parseKnownSettings(raw: unknown): KnownSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_KNOWN_SETTINGS;
  const obj = raw as { by_channel?: unknown; default_user_id?: unknown };
  const byChannel: Record<string, string> = {};
  if (obj.by_channel && typeof obj.by_channel === "object" && !Array.isArray(obj.by_channel)) {
    for (const [channelId, userId] of Object.entries(obj.by_channel as Record<string, unknown>)) {
      if (typeof userId === "string" && userId) byChannel[channelId] = userId;
    }
  }
  const defaultUserId = typeof obj.default_user_id === "string" && obj.default_user_id ? obj.default_user_id : null;
  return { byChannel, defaultUserId };
}

/** La forma en que se guarda. */
export function serializeKnownSettings(settings: KnownSettings): { by_channel: Record<string, string>; default_user_id: string | null } {
  return { by_channel: settings.byChannel, default_user_id: settings.defaultUserId };
}

/**
 * A quien va un chat de un conocido: la persona de esa cuenta, la por defecto,
 * el Owner. Solo gente que sigue en el equipo.
 */
export function knownAssignee(raw: unknown, channelId: string, memberIds: Iterable<string>, ownerId: string | null): string | null {
  const settings = parseKnownSettings(raw);
  const members = new Set(memberIds);
  for (const candidate of [settings.byChannel[channelId], settings.defaultUserId]) {
    if (candidate && members.has(candidate)) return candidate;
  }
  return ownerId && members.has(ownerId) ? ownerId : null;
}

/** Valida lo que manda la pantalla contra el equipo y las cuentas reales. */
export function checkKnownSettings(
  input: { byChannel?: unknown; defaultUserId?: unknown },
  known: { memberIds: Iterable<string>; channelIds: Iterable<string> },
): { ok: true; value: KnownSettings } | { ok: false; error: string } {
  const members = new Set(known.memberIds);
  const channels = new Set(known.channelIds);
  const byChannel: Record<string, string> = {};
  if (input.byChannel && typeof input.byChannel === "object" && !Array.isArray(input.byChannel)) {
    for (const [channelId, userId] of Object.entries(input.byChannel as Record<string, unknown>)) {
      if (userId === null || userId === "") continue;
      if (typeof userId !== "string" || !members.has(userId)) return { ok: false, error: "Alguna de esas personas ya no está en el equipo." };
      if (!channels.has(channelId)) return { ok: false, error: "Alguna de esas cuentas ya no está conectada." };
      byChannel[channelId] = userId;
    }
  }
  let defaultUserId: string | null = null;
  if (typeof input.defaultUserId === "string" && input.defaultUserId) {
    if (!members.has(input.defaultUserId)) return { ok: false, error: "Esa persona ya no está en el equipo." };
    defaultUserId = input.defaultUserId;
  }
  return { ok: true, value: { byChannel, defaultUserId } };
}

export interface KnownGateInput {
  isKnown: boolean;
  /** Quien puso la marca. */
  markedBy: string | null;
  /** El responsable del chat (a quien se lo asigno la marca). */
  assignedTo: string | null;
  viewerId: string;
}

/**
 * El aviso antes de abrir: si es un conocido y quien mira NO es quien lo marco
 * ni el responsable del chat. Es un aviso, no un bloqueo: "Abrir igual" entra.
 */
export function knownGate(input: KnownGateInput): boolean {
  if (!input.isKnown) return false;
  return input.viewerId !== input.markedBy && input.viewerId !== input.assignedTo;
}

/** Cómo se dice de quien es el conocido ("Conocido de Ana"). */
export function knownLabel(markedByName: string | null): string {
  return markedByName ? `Conocido de ${markedByName}` : "Conocido";
}

/** Quien puede quitar la marca: quien la puso o quien puede borrar contactos. */
export function canUnmarkKnown(input: { viewerId: string; markedBy: string | null; canDeleteContacts: boolean }): boolean {
  return input.canDeleteContacts || (input.markedBy !== null && input.markedBy === input.viewerId);
}
