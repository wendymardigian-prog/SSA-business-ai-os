/**
 * Variables de agenda para los flows (F47): `booking.*` y
 * `scheduling.link.<usuario>.<slug>`.
 *
 * Se arman como un objeto anidado para `interpolateVariables` del flow
 * engine (`{{booking.start_invitee}}`, `{{booking.answers.presupuesto}}`).
 * Cuando el flow no tiene agenda en el contexto, `emptyBookingVariables()`
 * deja todo en texto vacío: el mensaje no se rompe ni muestra "{{…}}".
 */
import type { Booking, EventType } from "../types";
import { formatDateLong, formatDateTimeWithZone, formatSlotLabel } from "../booker/format";
import { bookingLocationText } from "../ics";

export interface BookingVariables {
  event_title: string;
  category_area: string;
  category_type: string;
  start_invitee: string;
  start_host: string;
  date_invitee: string;
  time_invitee: string;
  invitee_timezone: string;
  duration: string;
  location: string;
  /** Donde es, con el link si es un Meet: nunca queda vacia. */
  meeting_place: string;
  meet_url: string;
  host_name: string;
  reschedule_url: string;
  cancel_url: string;
  cancellation_reason: string;
  status: string;
  /**
   * Días enteros que pasaron desde que terminó la reunión, al momento de armar las variables (un número como texto). Una
   * reunión que todavía no terminó es "0". Sirve para la VIGENCIA de una serie de recuperación: «si el no show se marcó
   * más de 2 días después de la llamada, no arranques» (`{{booking.days_since_end}}` mayor que 2).
   */
  days_since_end: string;
  answers: Record<string, string>;
}

export const BOOKING_VARIABLE_KEYS: (keyof Omit<BookingVariables, "answers">)[] = [
  "event_title",
  "category_area",
  "category_type",
  "start_invitee",
  "start_host",
  "date_invitee",
  "time_invitee",
  "invitee_timezone",
  "duration",
  "location",
  "meeting_place",
  "meet_url",
  "host_name",
  "reschedule_url",
  "cancel_url",
  "cancellation_reason",
  "status",
  "days_since_end",
];

export function emptyBookingVariables(): BookingVariables {
  const out = Object.fromEntries(BOOKING_VARIABLE_KEYS.map((k) => [k, ""])) as Omit<BookingVariables, "answers">;
  return { ...out, answers: {} };
}

export interface HostInfo {
  name: string;
  timezone: string;
}

export interface VariablesOptions {
  /** URL pública base (dominio propio o NEXT_PUBLIC_APP_URL), sin barra final. */
  baseUrl: string;
  /** El «ahora» con el que se cuentan los días desde que terminó la reunión. Solo lo usan los tests. */
  now?: Date;
}

/** Una respuesta de la reserva como texto: las de selección múltiple, unidas por comas. */
export function answerToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function bookingManageUrl(baseUrl: string, uid: string): string {
  return `${baseUrl.replace(/\/$/, "")}/calendario/agenda/${uid}`;
}

export function bookingRescheduleUrl(baseUrl: string, uid: string): string {
  return `${bookingManageUrl(baseUrl, uid)}/reagendar`;
}

/** Donde es, en una linea que siempre dice algo: el Meet con su link, el texto escrito, o "A confirmar". */
export function meetingPlace(booking: Pick<Booking, "location_type" | "location_text" | "meet_url">): string {
  if (booking.location_type === "google_meet") return booking.meet_url ? `Google Meet: ${booking.meet_url}` : "Google Meet";
  return booking.location_text?.trim() || "A confirmar";
}

export function bookingVariables(
  booking: Booking,
  eventType: Pick<EventType, "title" | "duration_minutes">,
  host: HostInfo,
  options: VariablesOptions,
): BookingVariables {
  const inviteeTz = booking.booker_timezone || booking.host_timezone || host.timezone;
  const hostTz = booking.host_timezone || host.timezone;
  const durationMinutes = Math.round((Date.parse(booking.end_at) - Date.parse(booking.start_at)) / 60_000) || eventType.duration_minutes;

  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(booking.responses ?? {})) answers[key] = answerToText(value);

  return {
    event_title: booking.title || eventType.title,
    category_area: booking.category_snapshot?.area_name ?? "",
    category_type: booking.category_snapshot?.type_name ?? "",
    start_invitee: formatDateTimeWithZone(booking.start_at, inviteeTz),
    start_host: formatDateTimeWithZone(booking.start_at, hostTz),
    date_invitee: formatDateLong(booking.start_at, inviteeTz),
    time_invitee: formatSlotLabel(booking.start_at, inviteeTz, "24h"),
    invitee_timezone: inviteeTz,
    duration: `${durationMinutes} minutos`,
    location: bookingLocationText(booking) ?? "",
    meeting_place: meetingPlace(booking),
    meet_url: booking.meet_url ?? "",
    host_name: host.name,
    reschedule_url: bookingRescheduleUrl(options.baseUrl, booking.uid),
    cancel_url: bookingManageUrl(options.baseUrl, booking.uid),
    cancellation_reason: booking.cancellation_reason ?? "",
    status: booking.status,
    days_since_end: String(daysSinceEnd(booking.end_at, options.now ?? new Date())),
    answers,
  };
}

/** Días enteros desde `endAt` hasta `now`; 0 si la reunión todavía no terminó o la fecha no se puede leer. */
export function daysSinceEnd(endAt: string, now: Date): number {
  const end = Date.parse(endAt);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((now.getTime() - end) / 86_400_000));
}

/**
 * `scheduling.link.<usuario>.<slug>` para insertar el link de cualquier
 * evento en cualquier mensaje. Los guiones del slug pasan a guión bajo en la
 * clave (`llamada-de-triaje` → `llamada_de_triaje`), porque el interpolador
 * del flow engine solo lee `\w` y puntos dentro de `{{…}}`.
 */
export function schedulingLinkVariables(
  events: { username: string; slug: string }[],
  baseUrl: string,
): { scheduling: { link: Record<string, Record<string, string>> } } {
  const link: Record<string, Record<string, string>> = {};
  const base = baseUrl.replace(/\/$/, "");
  for (const e of events) {
    const user = e.username.replace(/-/g, "_");
    (link[user] ??= {})[e.slug.replace(/-/g, "_")] = `${base}/calendario/${e.username}/${e.slug}`;
  }
  return { scheduling: { link } };
}

export function eventPublicUrl(baseUrl: string, username: string, slug: string): string {
  return `${baseUrl.replace(/\/$/, "")}/calendario/${username}/${slug}`;
}
