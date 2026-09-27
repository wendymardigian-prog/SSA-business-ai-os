// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Archivo `.ics` y links "Agregar a mi calendario" (F27). Adaptado de
 * `packages/features/bookings/lib/getCalendarLinks.ts`, sin la librería
 * `ics` (el VEVENT se arma a mano) ni recurrencia.
 */
import type { Booking } from "./types";

export type IcsBooking = Pick<
  Booking,
  "uid" | "title" | "start_at" | "end_at" | "status" | "ical_uid" | "location_type" | "location_text" | "meet_url"
>;

export interface IcsOptions {
  /** Dominio para el UID cuando no hay `ical_uid` (`uid@dominio`). */
  domain: string;
  description?: string | null;
  /** Link a la página de la agenda. */
  url?: string | null;
  /** Para DTSTAMP; por defecto ahora. */
  now?: Date;
  prodId?: string;
}

/** `2026-10-06T20:00:00.000Z` → `20261006T200000Z`. */
export function icsDate(iso: string | Date): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Escapa `\`, `;`, `,` y saltos de línea como pide RFC 5545. */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Pliega una línea a 75 octetos, con continuación " " (RFC 5545 §3.1). */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, "utf8");
    const limit = out.length === 0 ? 75 : 74;
    if (chunkBytes + len > limit) {
      out.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += ch;
    chunkBytes += len;
  }
  if (chunk) out.push(chunk);
  return out.map((c, i) => (i === 0 ? c : ` ${c}`)).join("\r\n");
}

/** La ubicación que va en LOCATION y en los links: el Meet si hay, si no el texto. */
export function bookingLocationText(booking: Pick<Booking, "location_type" | "location_text" | "meet_url">): string | null {
  if (booking.location_type === "google_meet") return booking.meet_url ?? "Google Meet";
  return booking.location_text ?? null;
}

export function icsUid(booking: Pick<Booking, "uid" | "ical_uid">, domain: string): string {
  return booking.ical_uid || `${booking.uid}@${domain}`;
}

export function buildIcs(booking: IcsBooking, options: IcsOptions): string {
  const now = options.now ?? new Date();
  const location = bookingLocationText(booking);
  const cancelled = booking.status.startsWith("cancelled");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${options.prodId ?? "-//SSA//Agenda//ES"}`,
    "CALSCALE:GREGORIAN",
    `METHOD:${cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${icsUid(booking, options.domain)}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(booking.start_at)}`,
    `DTEND:${icsDate(booking.end_at)}`,
    `SUMMARY:${escapeIcsText(booking.title)}`,
    ...(options.description ? [`DESCRIPTION:${escapeIcsText(options.description)}`] : []),
    ...(location ? [`LOCATION:${escapeIcsText(location)}`] : []),
    ...(options.url ? [`URL:${options.url}`] : []),
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export function icsFilename(booking: Pick<Booking, "uid">): string {
  return `agenda-${booking.uid}.ics`;
}

/** Link de plantilla de Google Calendar (abre "crear evento" con los datos). */
export function googleCalendarLink(booking: IcsBooking, description?: string | null): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    dates: `${icsDate(booking.start_at)}/${icsDate(booking.end_at)}`,
    text: booking.title,
  });
  if (description) params.set("details", description);
  const location = bookingLocationText(booking);
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Link de Outlook (outlook.live.com). */
export function outlookLink(booking: IcsBooking, description?: string | null): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    startdt: new Date(booking.start_at).toISOString(),
    enddt: new Date(booking.end_at).toISOString(),
    subject: booking.title,
  });
  if (description) params.set("body", description);
  const location = bookingLocationText(booking);
  if (location) params.set("location", location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
