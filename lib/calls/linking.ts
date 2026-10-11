/**
 * Vinculacion automatica de una llamada con su contacto y su agenda (F9).
 *
 * Funciones puras: la ingesta lee los candidatos (dos consultas por llamada,
 * no una por invitado) y estas deciden. Reglas que no se rompen:
 *  - NUNCA se crea un contacto. Si el invitado no existe, la llamada queda
 *    "sin vincular" y una persona la vincula.
 *  - NUNCA se vincula por nombre solo: solo por correo.
 *  - Una agenda puede tener varias llamadas (no hay unico sobre booking_id).
 *  - Las agendas canceladas no se vinculan solas.
 */

import type { CallAttendee, CallLinkMethod } from "@/lib/types/database";

/** La ventana para buscar la agenda: ±4 horas del inicio de la grabacion. */
export const BOOKING_WINDOW_MS = 4 * 60 * 60 * 1000;

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export interface ContactCandidate {
  id: string;
  created_at: string;
  email: string | null;
  secondary_email: string | null;
}

export interface BookingCandidate {
  id: string;
  contact_id: string;
  host_user_id: string;
  start_at: string;
  created_at: string;
  booker_email: string | null;
  /** `active | no_show | outcome | cancelled` (columna generada). */
  status_group: string | null;
}

/**
 * Los correos de los invitados EXTERNOS: los que Fathom marca `is_external`;
 * si no marca a ninguno, todos los que no son del equipo ni quien grabo.
 */
export function externalEmailsOf(
  attendees: CallAttendee[] | null | undefined,
  opts: { teamEmails?: string[]; recorderEmail?: string | null } = {},
): string[] {
  const list = Array.isArray(attendees) ? attendees : [];
  const flagged = list.some((a) => typeof a?.is_external === "boolean");
  const team = new Set([...(opts.teamEmails ?? []), opts.recorderEmail ?? ""].map(lower).filter(Boolean));
  const out: string[] = [];
  for (const a of list) {
    const e = lower(a?.email);
    if (!e || out.includes(e)) continue;
    if (flagged ? a.is_external === true : !team.has(e)) out.push(e);
  }
  return out;
}

/**
 * El contacto cuyo correo (o correo secundario) es el de un invitado externo.
 * Si hay varios, el creado mas recientemente. Nunca por nombre.
 */
export function pickContact(externalEmails: string[], candidates: ContactCandidate[]): ContactCandidate | null {
  const wanted = new Set(externalEmails.map(lower).filter(Boolean));
  if (wanted.size === 0) return null;
  const matches = candidates.filter((c) => wanted.has(lower(c.email)) || wanted.has(lower(c.secondary_email)));
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

/**
 * La agenda de la llamada: dentro de ±4 h, no cancelada, del mismo contacto o
 * con un invitado con ese correo. Gana la del MISMO anfitrion; si sigue el
 * empate, la mas cercana; si sigue, la creada mas recientemente.
 */
export function pickBooking(
  input: { recordedAt: string; recorderUserId: string | null; contactId: string | null; inviteeEmails: string[] },
  candidates: BookingCandidate[],
): BookingCandidate | null {
  const at = new Date(input.recordedAt).getTime();
  if (Number.isNaN(at)) return null;
  const invitees = new Set(input.inviteeEmails.map(lower).filter(Boolean));

  const eligible = candidates.filter((b) => {
    if (b.status_group === "cancelled") return false;
    if (Math.abs(new Date(b.start_at).getTime() - at) > BOOKING_WINDOW_MS) return false;
    return (input.contactId !== null && b.contact_id === input.contactId) || invitees.has(lower(b.booker_email));
  });
  if (eligible.length === 0) return null;

  const distance = (b: BookingCandidate) => Math.abs(new Date(b.start_at).getTime() - at);
  return [...eligible].sort((a, b) => {
    const hostA = input.recorderUserId !== null && a.host_user_id === input.recorderUserId ? 0 : 1;
    const hostB = input.recorderUserId !== null && b.host_user_id === input.recorderUserId ? 0 : 1;
    if (hostA !== hostB) return hostA - hostB;
    const d = distance(a) - distance(b);
    if (d !== 0) return d;
    return b.created_at.localeCompare(a.created_at);
  })[0];
}

export interface LinkResult {
  contact_id: string | null;
  booking_id: string | null;
  link_method: CallLinkMethod;
}

/** Une las dos decisiones: contacto, agenda y por que camino se vinculo. */
export function computeAutoLink(
  input: { recordedAt: string; recorderUserId: string | null; attendees: CallAttendee[]; teamEmails?: string[]; recorderEmail?: string | null },
  contacts: ContactCandidate[],
  bookings: BookingCandidate[],
): LinkResult {
  const external = externalEmailsOf(input.attendees, { teamEmails: input.teamEmails, recorderEmail: input.recorderEmail });
  const contact = pickContact(external, contacts);
  const booking = pickBooking(
    { recordedAt: input.recordedAt, recorderUserId: input.recorderUserId, contactId: contact?.id ?? null, inviteeEmails: external },
    bookings,
  );
  // Si la agenda tiene contacto y la llamada no, la llamada toma ese contacto.
  const contactId = contact?.id ?? booking?.contact_id ?? null;
  const link_method: CallLinkMethod = contact && booking ? "auto_email_booking" : contact ? "auto_email" : booking ? "auto_booking" : "none";
  return { contact_id: contactId, booking_id: booking?.id ?? null, link_method };
}
