/**
 * La copia de los eventos de Google Calendar que se ven en la Agenda (00510). Pura: sin base ni red.
 *
 * Qué se guarda:
 *   - solo los calendarios con «Mostrar en Agenda» (`calendars.show_in_agenda`);
 *   - de 60 días atrás a 12 meses adelante (lo que sale de esa ventana se borra);
 *   - un evento cancelado o sin horario se borra de la copia;
 *   - un evento de una reunión de la plataforma se guarda igual, con `booking_id`, y la Agenda lo muestra como
 *     reunión (nunca dos veces).
 */
import type { GoogleEventChange } from "./client";

export const MIRROR_PAST_DAYS = 60;
export const MIRROR_FUTURE_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** La primera lectura de un calendario con «Mostrar en Agenda»: 60 días atrás. */
export function mirrorFullSyncFrom(now: Date): string {
  return new Date(now.getTime() - MIRROR_PAST_DAYS * DAY_MS).toISOString();
}

export function mirrorWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - MIRROR_PAST_DAYS * DAY_MS),
    to: new Date(now.getTime() + MIRROR_FUTURE_DAYS * DAY_MS),
  };
}

export interface MirrorCalendar {
  id: string;
  workspace_id: string;
  user_id: string;
  connection_id: string;
}

/** Una fila de `google_calendar_events` (sin `id`, `booking_id` ni `created_at`: los pone quien guarda). */
export interface MirrorRow {
  workspace_id: string;
  user_id: string;
  connection_id: string;
  calendar_id: string;
  external_event_id: string;
  recurring_event_id: string | null;
  ical_uid: string | null;
  etag: string | null;
  status: "confirmed" | "tentative";
  summary: string | null;
  description: string | null;
  location: string | null;
  html_link: string | null;
  meet_url: string | null;
  organizer_email: string | null;
  organizer_self: boolean;
  attendees: Array<{ email: string; name: string | null; response: string; self: boolean; organizer: boolean; optional: boolean; resource: boolean }>;
  self_response_status: string | null;
  guests_can_modify: boolean;
  start_at: string;
  end_at: string;
  all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  time_zone: string | null;
  transparency: "opaque" | "transparent";
  google_event_type: string;
  google_updated_at: string | null;
  synced_at: string;
}

export type MirrorDecision =
  | { kind: "upsert"; row: MirrorRow; bookingUid: string | null }
  | { kind: "delete"; reason: "cancelled" | "no_time" | "out_of_window" };

/** Mi respuesta a la invitación: la del invitado `self`, o «aceptado» si lo organicé yo. */
export function selfResponse(ev: Pick<GoogleEventChange, "attendees" | "organizerSelf">): string | null {
  const me = ev.attendees.find((a) => a.self);
  if (me) return me.responseStatus;
  return ev.organizerSelf ? "accepted" : null;
}

/** El instante (UTC) de una fecha civil a medianoche UTC: para buscar los de todo el día por rango. */
function dateToUtc(date: string): string {
  return `${date}T00:00:00.000Z`;
}

export function toMirrorRow(ev: GoogleEventChange, cal: MirrorCalendar, now: Date): MirrorDecision {
  if (ev.status === "cancelled") return { kind: "delete", reason: "cancelled" };

  let startAt: string | null;
  let endAt: string | null;
  if (ev.allDay) {
    if (!ev.startDate) return { kind: "delete", reason: "no_time" };
    startAt = dateToUtc(ev.startDate);
    endAt = dateToUtc(ev.endDate ?? ev.startDate);
  } else {
    startAt = ev.startUtc;
    endAt = ev.endUtc;
  }
  if (!startAt || !endAt || Date.parse(endAt) < Date.parse(startAt)) return { kind: "delete", reason: "no_time" };

  const window = mirrorWindow(now);
  if (Date.parse(endAt) < window.from.getTime() || Date.parse(startAt) > window.to.getTime()) {
    return { kind: "delete", reason: "out_of_window" };
  }

  return {
    kind: "upsert",
    bookingUid: ev.bookingUid,
    row: {
      workspace_id: cal.workspace_id,
      user_id: cal.user_id,
      connection_id: cal.connection_id,
      calendar_id: cal.id,
      external_event_id: ev.id,
      recurring_event_id: ev.recurringEventId,
      ical_uid: ev.iCalUID,
      etag: ev.etag,
      status: ev.status,
      summary: ev.summary,
      description: ev.description,
      location: ev.location,
      html_link: ev.htmlLink,
      meet_url: ev.meetUrl,
      organizer_email: ev.organizerEmail,
      organizer_self: ev.organizerSelf,
      attendees: ev.attendees.map((a) => ({
        email: a.email,
        name: a.displayName,
        response: a.responseStatus,
        self: a.self,
        organizer: a.organizer,
        optional: a.optional,
        resource: a.resource,
      })),
      self_response_status: selfResponse(ev),
      guests_can_modify: ev.guestsCanModify,
      start_at: startAt,
      end_at: endAt,
      all_day: ev.allDay,
      start_date: ev.allDay ? ev.startDate : null,
      end_date: ev.allDay ? (ev.endDate ?? ev.startDate) : null,
      time_zone: ev.timeZone,
      transparency: ev.transparency,
      google_event_type: ev.eventType,
      google_updated_at: ev.updated,
      synced_at: now.toISOString(),
    },
  };
}
