/**
 * Sugerencias de agenda para una llamada sin vincular: por correo, por nombre
 * y por fecha (F13). Logica pura (sin Supabase) para poder probarla.
 *
 * Portado de prevxcrm (`meeting-appointment-suggestions.ts`), adaptado a
 * `bookings` (booker_email, booker_name, start_at) y sin `date-fns-tz`.
 */

import { civilDate, endOfDay, startOfDay } from "@/lib/dates";

export type MatchKind = "email" | "nombre" | "fecha";

export const MATCH_LABELS: Record<MatchKind, string> = {
  email: "Coincide por correo",
  nombre: "Coincide por nombre",
  fecha: "Coincide por fecha",
};

export interface BookingCandidate {
  id: string;
  start_at: string | null;
  email: string | null;
  full_name: string | null;
}
export interface BookingSuggestion extends BookingCandidate {
  match: MatchKind;
  /** El motivo, en palabras. */
  reason: string;
}

interface Attendee { email?: string | null; name?: string | null; is_external?: boolean | null }
interface Utterance { speaker?: { display_name?: string | null; matched_calendar_invitee_email?: string | null } }

const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Quita caracteres que rompen los filtros de PostgREST. */
export function sanitizeTerm(s: string): string {
  return s.replace(/[,.:()*%\\]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Personas de la llamada que no son el anfitrion ni el equipo: correos de
 * invitados y nombres (invitados + voces de la transcripcion sin correo, que
 * son quienes entraron por link).
 */
export function meetingPeople(
  attendees: unknown,
  transcript: unknown,
  hostEmail: string | null,
  teamNames: string[] = [],
): { emails: string[]; names: string[] } {
  const host = norm(hostEmail);
  const team = new Set(teamNames.map(norm).filter(Boolean));
  const emails = new Set<string>();
  const names = new Map<string, string>();
  const list = Array.isArray(attendees) ? (attendees as Attendee[]) : [];
  for (const a of list) {
    const e = norm(a?.email);
    if (e && e !== host && a?.is_external !== false) emails.add(e);
    const n = a?.name && !a.name.includes("@") ? a.name : null;
    if (n && e !== host && a?.is_external !== false && !team.has(norm(n))) names.set(norm(n), n.trim());
  }
  const utt = Array.isArray(transcript) ? (transcript as Utterance[]) : [];
  for (const u of utt) {
    const n = u?.speaker?.display_name;
    const e = norm(u?.speaker?.matched_calendar_invitee_email);
    if (!n || (e && e === host) || team.has(norm(n))) continue;
    if (e) emails.add(e);
    names.set(norm(n), n.trim());
  }
  const cleanNames = [...names.values()].map(sanitizeTerm).filter((n) => n.length >= 3);
  return { emails: [...emails], names: [...new Set(cleanNames)].slice(0, 5) };
}

/** El dia completo de la llamada en la zona dada, como rango UTC [desde, hasta]. */
export function meetingDayRange(iso: string, timeZone: string): { from: string; to: string } {
  const { year, month, day } = civilDate(new Date(iso), timeZone);
  return {
    from: startOfDay(year, month, day, timeZone).toISOString(),
    to: endOfDay(year, month, day, timeZone).toISOString(),
  };
}

/**
 * Une las tres listas sin repetir: una agenda queda con su mejor coincidencia
 * (correo > nombre > fecha) y con el motivo.
 */
export function suggestBookings(
  byEmail: BookingCandidate[],
  byName: BookingCandidate[],
  byDate: BookingCandidate[],
  limit = 12,
): BookingSuggestion[] {
  const seen = new Set<string>();
  const out: BookingSuggestion[] = [];
  const add = (list: BookingCandidate[], match: MatchKind, reason: (c: BookingCandidate) => string) => {
    for (const a of list) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ ...a, match, reason: reason(a) });
    }
  };
  add(byEmail, "email", (c) => `Reservó con ${c.email ?? "el mismo correo"} que figura en la llamada`);
  add(byName, "nombre", (c) => `${c.full_name ?? "Esa persona"} se llama igual que alguien de la llamada`);
  add(byDate, "fecha", () => "Es una agenda del mismo día de la llamada");
  return out.slice(0, limit);
}
