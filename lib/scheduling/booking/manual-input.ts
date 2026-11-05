/**
 * Agendar a mano en un solo paso (octubre 2026): lo que manda el modal, ya
 * validado. Lo usan el modal (para avisar mientras se completa) y la accion del
 * servidor (la barrera de verdad), asi dicen lo mismo.
 *
 * Como en Google Calendar: un titulo (escrito o el de un evento elegido), el
 * invitado (un contacto que ya existe, o nombre + email), el dia, la hora, la
 * duracion y notas. El horario es libre: no se limita a los turnos del evento.
 *
 * Puro: sin React ni base.
 */

import { isValidDateString, isValidWallTime, wallClockToUtc } from "@/lib/scheduling/time/tz";
import { inferTimezone } from "@/lib/agent/tools/scheduling/timezone";
import { isValidTimeZone } from "@/lib/timezone";

export const MANUAL_TITLE_MAX = 120;
export const MANUAL_NOTES_MAX = 2000;
export const MANUAL_LOCATION_MAX = 500;
export const MANUAL_DURATION_MIN = 5;
export const MANUAL_DURATION_MAX = 12 * 60;
/** Las duraciones que ofrece el desplegable (se puede escribir otra). */
export const MANUAL_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Donde es la reunion: un Google Meet (lo crea Google en el calendario de quien
 * atiende) o un texto libre (una direccion, un link de Zoom). `text` vacio =
 * "A confirmar". Sin `location`, la reunion usa la del evento.
 */
export type ManualLocation = { kind: "google_meet" } | { kind: "text"; text: string | null };

export interface ManualBookingInput {
  /** El evento elegido, o null para un titulo libre. */
  eventTypeId?: string | null;
  title?: string;
  /** Solo sin evento: quien atiende (por defecto, quien agenda). */
  hostUserId?: string | null;
  /** Solo sin evento: el area (por defecto, "Otros"). */
  categoryId?: string | null;
  /** YYYY-MM-DD y HH:mm, en `timezone`. */
  date?: string;
  time?: string;
  durationMinutes?: number;
  /** La zona en la que se escribieron el dia y la hora: la de quien agenda. */
  timezone?: string;
  /** La zona del invitado: en la que le llegan los emails. Sin elegir, `timezone`. */
  inviteeTimezone?: string;
  /** Quien agenda la eligio a mano (se guarda en el contacto, aunque ya tuviera otra). */
  inviteeTimezoneChosen?: boolean;
  contactId?: string | null;
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  location?: ManualLocation | null;
}

export interface ManualBookingPlan {
  eventTypeId: string | null;
  /** "" = usar el del evento. */
  title: string;
  hostUserId: string | null;
  categoryId: string | null;
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
  timezone: string;
  inviteeTimezone: string;
  inviteeTimezoneChosen: boolean;
  contactId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** null = la del evento. */
  location: ManualLocation | null;
}

export type ManualBookingField = "title" | "contact" | "name" | "email" | "date" | "time" | "duration" | "notes" | "location" | "timezone";

export type ManualBookingCheck =
  | { ok: true; plan: ManualBookingPlan }
  | { ok: false; field: ManualBookingField; error: string };

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function planManualBooking(input: ManualBookingInput): ManualBookingCheck {
  const eventTypeId = clean(input.eventTypeId) || null;
  const title = clean(input.title);
  if (!eventTypeId && !title) return { ok: false, field: "title", error: "Escribile un título o elegí un evento." };
  if (title.length > MANUAL_TITLE_MAX) return { ok: false, field: "title", error: `El título puede tener hasta ${MANUAL_TITLE_MAX} caracteres.` };

  const contactId = clean(input.contactId) || null;
  let name: string | null = null;
  let email: string | null = null;
  const phone = clean(input.phone) || null;
  if (!contactId) {
    name = clean(input.name) || null;
    email = clean(input.email).toLowerCase() || null;
    if (!name) return { ok: false, field: "name", error: "Elegí un contacto o escribí el nombre del invitado." };
    if (!email) return { ok: false, field: "email", error: "Escribí el email del invitado." };
    if (!EMAIL_RE.test(email)) return { ok: false, field: "email", error: "Ese email no parece válido." };
  }

  const date = clean(input.date);
  const time = clean(input.time);
  if (!isValidDateString(date)) return { ok: false, field: "date", error: "Elegí el día." };
  if (!isValidWallTime(time) || time === "24:00") return { ok: false, field: "time", error: "Elegí la hora." };

  const duration = Number(input.durationMinutes);
  if (!Number.isInteger(duration) || duration < MANUAL_DURATION_MIN || duration > MANUAL_DURATION_MAX) {
    return { ok: false, field: "duration", error: `La duración va de ${MANUAL_DURATION_MIN} minutos a ${MANUAL_DURATION_MAX / 60} horas.` };
  }

  const notes = clean(input.notes) || null;
  if (notes && notes.length > MANUAL_NOTES_MAX) return { ok: false, field: "notes", error: `Las notas pueden tener hasta ${MANUAL_NOTES_MAX} caracteres.` };

  let location: ManualLocation | null = null;
  if (input.location?.kind === "google_meet") location = { kind: "google_meet" };
  else if (input.location?.kind === "text") {
    const text = clean(input.location.text) || null;
    if (text && text.length > MANUAL_LOCATION_MAX) {
      return { ok: false, field: "location", error: `La ubicación puede tener hasta ${MANUAL_LOCATION_MAX} caracteres.` };
    }
    location = { kind: "text", text };
  }

  const timezone = clean(input.timezone) || "UTC";
  if (!isValidTimeZone(timezone)) return { ok: false, field: "time", error: "No pude entender esa fecha y hora." };
  const inviteeTimezone = clean(input.inviteeTimezone) || timezone;
  if (!isValidTimeZone(inviteeTimezone)) return { ok: false, field: "timezone", error: "Elegí una zona horaria válida para el invitado." };

  let start: Date;
  try {
    start = wallClockToUtc(date, time, timezone);
  } catch {
    return { ok: false, field: "time", error: "No pude entender esa fecha y hora." };
  }
  if (Number.isNaN(start.getTime())) return { ok: false, field: "time", error: "No pude entender esa fecha y hora." };

  return {
    ok: true,
    plan: {
      eventTypeId,
      title,
      hostUserId: eventTypeId ? null : clean(input.hostUserId) || null,
      categoryId: eventTypeId ? null : clean(input.categoryId) || null,
      startUtc: start.toISOString(),
      endUtc: new Date(start.getTime() + duration * 60_000).toISOString(),
      durationMinutes: duration,
      timezone,
      inviteeTimezone,
      inviteeTimezoneChosen: input.inviteeTimezoneChosen === true,
      contactId,
      name,
      email,
      phone,
      notes,
      location,
    },
  };
}

export interface InitialInviteeTimezone {
  timezone: string;
  /** De donde salio, para decirselo a quien agenda: `viewer` es una suposicion. */
  source: "contact" | "phone" | "viewer";
}

/**
 * La zona con la que arranca el campo del invitado: la guardada en el contacto,
 * la que se deduce de su telefono o, sin ningun dato, la de quien agenda.
 * El orden es el mismo con el que el agente deduce la zona de un lead.
 */
export function initialInviteeTimezone(input: {
  contactTimezone?: string | null;
  phone?: string | null;
  viewerTimezone: string;
}): InitialInviteeTimezone {
  const contactTimezone = input.contactTimezone && isValidTimeZone(input.contactTimezone) ? input.contactTimezone : null;
  const inferred = inferTimezone({ contactTimezone, phone: input.phone, workspaceTimezone: input.viewerTimezone });
  return { timezone: inferred.timezone, source: inferred.source === "workspace" ? "viewer" : inferred.source };
}
