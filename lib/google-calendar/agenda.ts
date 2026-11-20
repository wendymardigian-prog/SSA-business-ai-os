/**
 * La capa «Google» del calendario de la Agenda (00510). PURO: el componente solo lo compone.
 *
 * - Lo que viaja al navegador (`AgendaGoogleEvent`) es lo propio de quien mira: sus eventos con detalle. De otras
 *   personas solo viaja el horario ocupado (`AgendaGoogleBusy`, de `google_busy_blocks`).
 * - No se muestra: lo que es de una reunión de la plataforma (se ve como reunión), lo que la persona rechazó y la
 *   «ubicación de trabajo» de Google.
 * - Se puede mover y editar solo lo de un calendario donde se puede escribir y donde la persona organiza el evento.
 */
import { addDays, dateInTz, eachDate, minutesOfDayInTz } from "@/lib/scheduling/time/tz";
import type { CalendarView } from "@/lib/scheduling/calendar-view";

export interface AgendaGoogleAttendee {
  email: string;
  name: string | null;
  response: string;
  self: boolean;
  organizer: boolean;
  optional: boolean;
  resource: boolean;
}

/** Un evento de Google de quien mira, tal como lo usa la Agenda. */
export interface AgendaGoogleEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string | null;
  /** owner | writer | reader | freeBusyReader */
  accessRole: string;
  externalEventId: string;
  recurringEventId: string | null;
  etag: string | null;
  status: "confirmed" | "tentative";
  summary: string | null;
  description: string | null;
  location: string | null;
  htmlLink: string | null;
  meetUrl: string | null;
  organizerEmail: string | null;
  organizerSelf: boolean;
  attendees: AgendaGoogleAttendee[];
  selfResponse: string | null;
  guestsCanModify: boolean;
  startAt: string;
  endAt: string;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
  timeZone: string | null;
  transparency: "opaque" | "transparent";
  eventType: string;
  bookingId: string | null;
}

/** El horario ocupado de otra persona: sin título, sin invitados. */
export interface AgendaGoogleBusy {
  key: string;
  userId: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
}

/** El interruptor en la URL: prendido salvo `google=0`. */
export function parseGoogleLayer(value: string | string[] | null | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v !== "0";
}

export function googleLayerParam(on: boolean): string | null {
  return on ? null : "0";
}

/** ¿Se dibuja en la Agenda? */
export function visibleInAgenda(ev: Pick<AgendaGoogleEvent, "bookingId" | "selfResponse" | "eventType">): boolean {
  if (ev.bookingId) return false;
  if (ev.selfResponse === "declined") return false;
  if (ev.eventType === "workingLocation") return false;
  return true;
}

/**
 * ¿Se puede mover, cambiar la duración o editar desde la Agenda? En Google, mover un evento que organiza otra
 * persona solo cambia la copia propia: por eso solo lo que organiza quien mira, en un calendario donde puede escribir.
 */
export function canEditGoogleEvent(ev: Pick<AgendaGoogleEvent, "accessRole" | "organizerSelf" | "eventType">): boolean {
  if (ev.accessRole !== "owner" && ev.accessRole !== "writer") return false;
  if (ev.eventType === "birthday" || ev.eventType === "fromGmail") return false;
  return ev.organizerSelf;
}

/** ¿Se puede borrar? Lo mismo que editar. */
export const canDeleteGoogleEvent = canEditGoogleEvent;

/** ¿Tiene invitados además de quien mira? (para preguntar si se les avisa). */
export function hasOtherGuests(ev: Pick<AgendaGoogleEvent, "attendees">): boolean {
  return ev.attendees.some((a) => !a.self && !a.resource);
}

/** El invitado que se sugiere como contacto al pasar el evento al sistema: el primero que no soy yo ni una sala. */
export function suggestedContact(ev: Pick<AgendaGoogleEvent, "attendees" | "organizerSelf" | "organizerEmail">): { email: string; name: string | null } | null {
  const guest = ev.attendees.find((a) => !a.self && !a.resource);
  if (guest) return { email: guest.email, name: guest.name };
  if (!ev.organizerSelf && ev.organizerEmail) return { email: ev.organizerEmail, name: null };
  return null;
}

// ── Ubicación en el calendario ────────────────────────────────────────────────────────────────────────────────────

export type GooglePlaced =
  | { kind: "event"; key: string; event: AgendaGoogleEvent; timed: true; startMinutes: number; endMinutes: number }
  | { kind: "event"; key: string; event: AgendaGoogleEvent; timed: false }
  | { kind: "busy"; key: string; busy: AgendaGoogleBusy; timed: true; startMinutes: number; endMinutes: number }
  | { kind: "busy"; key: string; busy: AgendaGoogleBusy; timed: false };

export interface GooglePlacement {
  byDate: Record<string, GooglePlaced[]>;
}

/** Los días civiles que cubre uno de todo el día (fin exclusivo), recortados al rango. */
function allDayDates(startDate: string, endDate: string, range: { from: string; to: string }): string[] {
  const last = addDays(endDate, -1) < startDate ? startDate : addDays(endDate, -1);
  const from = startDate > range.from ? startDate : range.from;
  const to = last < range.to ? last : range.to;
  return from > to ? [] : eachDate(from, to);
}

function timedPlacement(startAt: string, endAt: string, tz: string): { date: string; startMinutes: number; endMinutes: number } {
  const date = dateInTz(startAt, tz);
  const endDate = dateInTz(endAt, tz);
  const startMinutes = minutesOfDayInTz(startAt, tz);
  let endMinutes = minutesOfDayInTz(endAt, tz);
  if (endDate !== date) {
    let days = 0;
    for (let d = date; d !== endDate && days < 366; d = addDays(d, 1)) days++;
    endMinutes += days * 1440;
  }
  return { date, startMinutes, endMinutes: Math.max(endMinutes, startMinutes) };
}

export function placeGoogleInCalendar(input: {
  events: readonly AgendaGoogleEvent[];
  busy: readonly AgendaGoogleBusy[];
  viewerTz: string;
  view: CalendarView;
  range: { from: string; to: string };
}): GooglePlacement {
  const byDate: Record<string, GooglePlaced[]> = {};
  for (const d of eachDate(input.range.from, input.range.to)) byDate[d] = [];
  const inRange = (d: string) => d >= input.range.from && d <= input.range.to;

  for (const event of input.events) {
    if (!visibleInAgenda(event)) continue;
    if (event.allDay && event.startDate) {
      for (const d of allDayDates(event.startDate, event.endDate ?? event.startDate, input.range)) {
        byDate[d].push({ kind: "event", key: `g:${event.id}`, event, timed: false });
      }
      continue;
    }
    const p = timedPlacement(event.startAt, event.endAt, input.viewerTz);
    if (!inRange(p.date)) continue;
    byDate[p.date].push({ kind: "event", key: `g:${event.id}`, event, timed: true, startMinutes: p.startMinutes, endMinutes: p.endMinutes });
  }

  for (const busy of input.busy) {
    if (busy.allDay && busy.startDate) {
      for (const d of allDayDates(busy.startDate, busy.endDate ?? busy.startDate, input.range)) {
        byDate[d].push({ kind: "busy", key: `o:${busy.key}`, busy, timed: false });
      }
      continue;
    }
    const p = timedPlacement(busy.startAt, busy.endAt, input.viewerTz);
    if (!inRange(p.date)) continue;
    byDate[p.date].push({ kind: "busy", key: `o:${busy.key}`, busy, timed: true, startMinutes: p.startMinutes, endMinutes: p.endMinutes });
  }

  for (const list of Object.values(byDate)) {
    list.sort((a, b) => (a.timed ? a.startMinutes : -1) - (b.timed ? b.startMinutes : -1));
  }
  return { byDate };
}

/** El texto de un evento: su título, o «(Sin título)» como en Google. Uno de otra persona dice «Ocupado». */
export function googleTitle(item: GooglePlaced, ownerName?: string): string {
  if (item.kind === "busy") return ownerName ? `Ocupado · ${ownerName}` : "Ocupado";
  return item.event.summary?.trim() || "(Sin título)";
}

/** El rango en UTC que se pide a la base para una vista: con un día de margen (los de todo el día van a medianoche UTC). */
export function googleQueryWindow(range: { from: string; to: string }): { from: string; to: string } {
  return { from: `${addDays(range.from, -1)}T00:00:00.000Z`, to: `${addDays(range.to, 2)}T00:00:00.000Z` };
}

// ── Mover y cambiar la duración ───────────────────────────────────────────────────────────────────────────────────

/**
 * «Toda la serie»: el evento madre se corre lo mismo que se movió la instancia, y la duración nueva se le aplica igual.
 * Devuelve el inicio y el fin nuevos del evento madre.
 */
export function shiftSeries(input: {
  masterStartUtc: string;
  instanceStartUtc: string;
  newInstanceStartUtc: string;
  newDurationMinutes: number;
}): { startUtc: string; endUtc: string } {
  const delta = Date.parse(input.newInstanceStartUtc) - Date.parse(input.instanceStartUtc);
  const start = Date.parse(input.masterStartUtc) + delta;
  return { startUtc: new Date(start).toISOString(), endUtc: new Date(start + input.newDurationMinutes * 60_000).toISOString() };
}

export function durationMinutesOf(ev: Pick<AgendaGoogleEvent, "startAt" | "endAt">): number {
  return Math.max(0, Math.round((Date.parse(ev.endAt) - Date.parse(ev.startAt)) / 60_000));
}

/**
 * La descripción de un evento de Google viene en HTML (la escribe cualquiera que invite). En la Agenda se muestra y se
 * edita como TEXTO: nunca se pinta el HTML. Saltos de línea por `<br>` y párrafos; el resto de las etiquetas, fuera.
 */
export function descriptionToText(html: string | null | undefined): string {
  if (!html) return "";
  const text = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<a\s[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const inner = label.replace(/<[^>]*>/g, "").trim();
      return inner && inner !== href ? `${inner} (${href})` : href;
    })
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
