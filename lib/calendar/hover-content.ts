/**
 * Lo que dice la tarjeta al pasar el mouse por un bloque del calendario de la Agenda. PURO: el componente solo lo
 * dibuja. Las fechas, en la zona de quien mira. (Las tareas arman la suya en `calendar-tasks.tsx`, dentro de su módulo.)
 */
import { formatSlotLabel } from "@/lib/scheduling/booker/format";
import { statusLabel } from "@/lib/scheduling/booking-status";
import type { BookingStatus } from "@/lib/scheduling/types";
import type { AgendaGoogleBusy, AgendaGoogleEvent } from "@/lib/google-calendar/agenda";

export interface HoverContent {
  title: string;
  lines: string[];
}

type TimeFormat = "12h" | "24h";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** «Martes, 17 de noviembre». Una fecha civil (de todo el día) se lee en UTC para no correrla de día. */
export function dayText(utcOrDate: string, timezone: string, civil = false): string {
  const d = civil ? new Date(`${utcOrDate}T12:00:00Z`) : new Date(utcOrDate);
  return capitalize(new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: civil ? "UTC" : timezone }).format(d));
}

function lastCivilDay(endDate: string): string {
  return new Date(Date.parse(`${endDate}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** El horario de un evento de Google (o de un «Ocupado»): con hora, o de todo el día. */
export function googleWhen(
  ev: Pick<AgendaGoogleEvent, "allDay" | "startDate" | "endDate" | "startAt" | "endAt">,
  timezone: string,
  timeFormat: TimeFormat,
): string {
  if (ev.allDay && ev.startDate) {
    const last = ev.endDate ? lastCivilDay(ev.endDate) : ev.startDate;
    return last > ev.startDate
      ? `${dayText(ev.startDate, timezone, true)} al ${dayText(last, timezone, true)} · Todo el día`
      : `${dayText(ev.startDate, timezone, true)} · Todo el día`;
  }
  return `${dayText(ev.startAt, timezone)} · ${formatSlotLabel(ev.startAt, timezone, timeFormat)} a ${formatSlotLabel(ev.endAt, timezone, timeFormat)}`;
}

export function bookingHover(
  item: {
    title: string;
    startAt: string;
    endAt: string;
    status: BookingStatus;
    contactName: string | null;
    bookerName: string | null;
    meetUrl: string | null;
    locationText: string | null;
    slotReleasedAt: string | null;
  },
  hostName: string | null,
  timezone: string,
  timeFormat: TimeFormat,
): HoverContent {
  const lines = [
    `${dayText(item.startAt, timezone)} · ${formatSlotLabel(item.startAt, timezone, timeFormat)} a ${formatSlotLabel(item.endAt, timezone, timeFormat)}`,
    `Estado: ${statusLabel(item.status)}`,
  ];
  if (item.title) lines.push(item.title);
  if (hostName) lines.push(`Atiende: ${hostName}`);
  if (item.meetUrl) lines.push("Google Meet");
  else if (item.locationText) lines.push(item.locationText);
  if (item.slotReleasedAt) lines.push("Espacio liberado: se puede agendar encima");
  return { title: item.contactName || item.bookerName || "Sin nombre", lines };
}

const MAX_GUESTS = 3;

export function googleHover(ev: AgendaGoogleEvent, timezone: string, timeFormat: TimeFormat): HoverContent {
  const lines = [googleWhen(ev, timezone, timeFormat), `Google Calendar · ${ev.calendarName}`];
  lines.push(ev.organizerSelf ? "Lo organizás vos" : `Organiza: ${ev.organizerEmail ?? "otra persona"}`);
  const guests = ev.attendees.filter((a) => !a.self && !a.resource);
  if (guests.length > 0) {
    const shown = guests.slice(0, MAX_GUESTS).map((g) => g.name || g.email);
    lines.push(`Invitados: ${shown.join(", ")}${guests.length > MAX_GUESTS ? ` y ${guests.length - MAX_GUESTS} más` : ""}`);
  }
  if (ev.meetUrl) lines.push("Google Meet");
  else if (ev.location) lines.push(ev.location);
  if (ev.recurringEventId) lines.push("Se repite");
  if (ev.transparency === "transparent") lines.push("Disponible: no bloquea horarios");
  lines.push("Solo en Google: no está en el sistema");
  return { title: ev.summary?.trim() || "(Sin título)", lines };
}

export function busyHover(busy: AgendaGoogleBusy, ownerName: string | undefined, timezone: string, timeFormat: TimeFormat): HoverContent {
  return {
    title: ownerName ? `Ocupado · ${ownerName}` : "Ocupado",
    lines: [googleWhen(busy, timezone, timeFormat), "Evento de su Google Calendar (sin detalle)"],
  };
}

/** Una clase en vivo del Portal (capa «Clases»): programa, horario con la zona de quien mira y cómo entrar. */
export function classHover(
  cls: { title: string; productTitle: string | null; startAt: string; endAt: string; meetingUrl: string | null; moved: boolean },
  hostName: string | null,
  timezone: string,
  timeFormat: TimeFormat,
): HoverContent {
  const zone = (timezone.split("/").pop() ?? timezone).replace(/_/g, " ");
  const lines = [
    `${dayText(cls.startAt, timezone)} · ${formatSlotLabel(cls.startAt, timezone, timeFormat)} a ${formatSlotLabel(cls.endAt, timezone, timeFormat)} (${zone})`,
    cls.productTitle ? `Clase en vivo · ${cls.productTitle}` : "Clase en vivo",
  ];
  if (hostName) lines.push(`Anfitrión: ${hostName}`);
  if (cls.moved) lines.push("Esta fecha se movió de su horario habitual");
  lines.push(cls.meetingUrl ? "Clic para entrar a la reunión" : "Sin link de reunión cargado");
  return { title: cls.title, lines };
}
