/**
 * Estado de las conexiones de calendario y si una persona puede recibir
 * agendas (F7). Puro: recibe las filas y decide.
 */

export type CalendarConnectionStatus = "connected" | "attention" | "revoked" | "error";

export interface ConnectionRowForStatus {
  id: string;
  status: "active" | "attention" | "revoked" | "error";
  granted_scopes: string[];
  last_error?: string | null;
}

const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/**
 * Como se muestra la conexion. `attention` = le falta el permiso de crear
 * eventos (sirve solo para conflictos) o Google marco algo que hay que
 * mirar; `revoked` y `error` piden reconectar.
 */
export function calendarConnectionStatus(connection: ConnectionRowForStatus): CalendarConnectionStatus {
  if (connection.status === "revoked") return "revoked";
  if (connection.status === "error") return "error";
  if (connection.status === "attention") return "attention";
  if (!connection.granted_scopes.includes(EVENTS_SCOPE)) return "attention";
  return "connected";
}

export function canCreateEventsWith(connection: ConnectionRowForStatus): boolean {
  return connection.status !== "revoked" && connection.status !== "error" && connection.granted_scopes.includes(EVENTS_SCOPE);
}

export const CONNECTION_STATUS_TEXT: Record<CalendarConnectionStatus, string> = {
  connected: "Conectada",
  attention: "Falta el permiso para crear eventos",
  revoked: "Reconectá tu Google Calendar",
  error: "Reconectá tu Google Calendar",
};

export interface CalendarRowForBookable {
  id: string;
  connection_id: string;
  check_conflicts: boolean;
  is_active: boolean;
}

export type NotBookableReason = "no_profile" | "profile_inactive" | "calendar_disconnected";

/**
 * Si los eventos de esta persona pueden ofrecer horarios.
 *
 * Una conexion revocada o con error frena SOLO si alguno de sus calendarios
 * esta en uso: como calendario de conflicto (del perfil o de un evento) o
 * como destino. Una cuenta caida que no se usa para nada no bloquea.
 */
export function isUserBookable(input: {
  profile: { is_active: boolean } | null;
  connections: ConnectionRowForStatus[];
  calendars: CalendarRowForBookable[];
  /** Ids de calendarios en uso por eventos (conflicto o destino), ademas del perfil. */
  calendarIdsInUse?: string[];
  defaultDestinationCalendarId?: string | null;
}): { ok: true } | { ok: false; reason: NotBookableReason } {
  if (!input.profile) return { ok: false, reason: "no_profile" };
  if (!input.profile.is_active) return { ok: false, reason: "profile_inactive" };

  const broken = new Set(
    input.connections.filter((c) => c.status === "revoked" || c.status === "error").map((c) => c.id),
  );
  if (broken.size === 0) return { ok: true };

  const inUse = new Set(input.calendarIdsInUse ?? []);
  if (input.defaultDestinationCalendarId) inUse.add(input.defaultDestinationCalendarId);

  const blocks = input.calendars.some(
    (cal) => broken.has(cal.connection_id) && cal.is_active && (cal.check_conflicts || inUse.has(cal.id)),
  );
  return blocks ? { ok: false, reason: "calendar_disconnected" } : { ok: true };
}
