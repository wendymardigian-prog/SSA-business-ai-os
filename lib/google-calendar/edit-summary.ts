/**
 * «Qué cambia en tu Google»: la lista que muestra el modal de confirmación antes de guardar un evento de Google
 * editado desde la Agenda. PURO.
 */
import { formatSlotLabel } from "@/lib/scheduling/booker/format";
import { dayText } from "@/lib/calendar/hover-content";

export interface GoogleEditState {
  summary: string;
  location: string;
  description: string;
  guests: string[];
  /** null en uno de todo el día (no se cambia el horario desde acá). */
  startUtc: string | null;
  durationMinutes: number;
}

function when(startUtc: string, minutes: number, tz: string, fmt: "12h" | "24h"): string {
  const end = new Date(Date.parse(startUtc) + minutes * 60_000).toISOString();
  return `${dayText(startUtc, tz)} · ${formatSlotLabel(startUtc, tz, fmt)} a ${formatSlotLabel(end, tz, fmt)}`;
}

function quote(text: string): string {
  const t = text.trim();
  if (!t) return "(vacío)";
  return `«${t.length > 60 ? `${t.slice(0, 57)}…` : t}»`;
}

const norm = (emails: string[]) => [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];

/** Las líneas de lo que cambió. Vacía = no hay cambios. */
export function googleEditSummary(before: GoogleEditState, after: GoogleEditState, tz: string, fmt: "12h" | "24h"): string[] {
  const lines: string[] = [];
  if (after.summary.trim() !== before.summary.trim()) lines.push(`Título: ${quote(before.summary)} → ${quote(after.summary)}`);
  if (
    after.startUtc &&
    before.startUtc &&
    (Date.parse(after.startUtc) !== Date.parse(before.startUtc) || after.durationMinutes !== before.durationMinutes)
  ) {
    lines.push(`Horario: ${when(before.startUtc, before.durationMinutes, tz, fmt)} → ${when(after.startUtc, after.durationMinutes, tz, fmt)}`);
  }
  if (after.location.trim() !== before.location.trim()) lines.push(`Lugar: ${quote(before.location)} → ${quote(after.location)}`);
  const b = norm(before.guests);
  const a = norm(after.guests);
  const added = a.filter((e) => !b.includes(e));
  const removed = b.filter((e) => !a.includes(e));
  if (added.length) lines.push(`Invitados que se suman: ${added.join(", ")}`);
  if (removed.length) lines.push(`Invitados que se sacan: ${removed.join(", ")}`);
  if (after.description.trim() !== before.description.trim()) lines.push("Descripción: cambia");
  return lines;
}

/** ¿Cambió algo del texto (título, lugar, invitados, descripción)? ¿Y el horario? */
export function googleEditParts(before: GoogleEditState, after: GoogleEditState): { text: boolean; time: boolean; guests: boolean } {
  const time =
    !!after.startUtc && !!before.startUtc && (Date.parse(after.startUtc) !== Date.parse(before.startUtc) || after.durationMinutes !== before.durationMinutes);
  const guests = norm(after.guests).join(",") !== norm(before.guests).join(",");
  const text =
    after.summary.trim() !== before.summary.trim() ||
    after.location.trim() !== before.location.trim() ||
    after.description.trim() !== before.description.trim() ||
    guests;
  return { text, time, guests };
}
