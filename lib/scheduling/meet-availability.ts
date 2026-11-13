/**
 * Si una reunion de esta persona (o de este evento) puede llevar un Google Meet.
 *
 * El link lo crea Google al crear el evento en el calendario destino de quien
 * atiende (`booking_google_sync`). Sin un destino que se pueda escribir, con su
 * cuenta conectada y con permiso para crear eventos, el Meet no llega nunca: la
 * reunion quedaria con "Google Meet (todavia sin link)" para siempre.
 *
 * El destino se resuelve igual que en el job (`resolveEventCalendars`: el del
 * evento, si no el por defecto del perfil). Aca se suma lo que el job descubre
 * recien al fallar: el permiso de escritura del calendario y el de la cuenta.
 *
 * Puro: recibe las filas y decide. La lectura esta en `data/meet-availability.ts`.
 */

import { canCreateEventsWith, type ConnectionRowForStatus } from "./bookable";
import { resolveEventCalendars, type CalendarForResolve } from "./resolve-calendars";

export interface MeetCalendarRow extends CalendarForResolve {
  user_id: string;
  connection_id: string;
}

export interface MeetConnectionRow extends ConnectionRowForStatus {
  user_id: string;
}

export interface MeetContext {
  calendars: MeetCalendarRow[];
  connections: MeetConnectionRow[];
  /** El calendario destino por defecto de cada persona (su perfil de agenda). */
  defaultDestinationByUser: Map<string, string | null>;
}

/** El calendario destino y su cuenta: alcanzan para crear un Meet. */
export function canCreateMeet(destination: CalendarForResolve | null, connection: ConnectionRowForStatus | null): boolean {
  if (!destination || !connection) return false;
  if (destination.access_role !== "owner" && destination.access_role !== "writer") return false;
  return canCreateEventsWith(connection);
}

/**
 * Para una persona: con `eventDestinationId` (el destino propio del evento) o
 * sin el (una reunion sin evento usa el destino por defecto de su perfil).
 */
export function meetAvailableFor(ctx: MeetContext, userId: string, eventDestinationId: string | null = null): boolean {
  const connections = ctx.connections.filter((c) => c.user_id === userId);
  const broken = new Set(connections.filter((c) => c.status === "revoked" || c.status === "error").map((c) => c.id));
  const calendars = ctx.calendars.filter((c) => c.user_id === userId).map((c) => ({ ...c, connection_broken: broken.has(c.connection_id) }));
  const { destination } = resolveEventCalendars(
    { destination_calendar_id: eventDestinationId },
    { default_destination_calendar_id: ctx.defaultDestinationByUser.get(userId) ?? null },
    calendars,
  );
  const connection = destination ? (connections.find((c) => c.id === destination.connection_id) ?? null) : null;
  return canCreateMeet(destination, connection);
}

/**
 * Reasignar con reunión nueva: el destino propio del evento es un calendario de
 * quien es dueño del evento. Para otra persona cuenta solo si es suyo; si no,
 * se usa su destino por defecto (igual que el job, `ownEventDestinationOnly`).
 */
export function ownEventDestination(ctx: MeetContext, userId: string, eventDestinationId: string | null): string | null {
  if (!eventDestinationId) return null;
  return ctx.calendars.some((c) => c.user_id === userId && c.id === eventDestinationId) ? eventDestinationId : null;
}
