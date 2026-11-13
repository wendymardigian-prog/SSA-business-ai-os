/**
 * Aviso de reunión sin grabación (Servicios A4, F139). PURA: el barrido horario (`call_missing_recording_sweep`)
 * junta las agendas y esto decide a cuáles avisar.
 *
 * Se avisa UNA vez por agenda que cumple todo esto:
 *   - del área Servicio, sin tipo Clase;
 *   - de un contacto con un servicio activo o pausado;
 *   - no cancelada ni marcada «no se presentó»;
 *   - terminó hace entre 2 y 26 horas;
 *   - sin grabación vinculada;
 *   - su anfitrión tiene Fathom conectado (si no, no hay de dónde esperar la grabación).
 *
 * La marca de que ya avisó va en `audit_log` (`svc.call_missing_recording`, entidad `booking`): `alreadyNotified`.
 */

import { isServiceMeeting } from "@/lib/services/call-link";

export const MISSING_RECORDING_MIN_HOURS = 2;
export const MISSING_RECORDING_MAX_HOURS = 26;

export type MissingRecordingCandidate = {
  bookingId: string;
  endAt: string;
  /** `bookings.status` (scheduled, cancelled_*, no_show, …). */
  status: string;
  areaKey: string | null;
  typeKey: string | null;
  contactHasActiveService: boolean;
  hasRecording: boolean;
  hostHasFathom: boolean;
  alreadyNotified: boolean;
};

export type MissingRecordingSkip =
  | "not_service"
  | "cancelled"
  | "no_show"
  | "too_early"
  | "too_late"
  | "no_active_service"
  | "has_recording"
  | "no_fathom"
  | "already_notified";

export function missingRecordingDecision(c: MissingRecordingCandidate, now: Date): { notify: true } | { notify: false; reason: MissingRecordingSkip } {
  if (!isServiceMeeting(c.areaKey, c.typeKey)) return { notify: false, reason: "not_service" };
  if (c.status.startsWith("cancelled")) return { notify: false, reason: "cancelled" };
  if (c.status === "no_show") return { notify: false, reason: "no_show" };
  const hours = (now.getTime() - new Date(c.endAt).getTime()) / 3_600_000;
  if (!(hours >= MISSING_RECORDING_MIN_HOURS)) return { notify: false, reason: "too_early" };
  if (hours > MISSING_RECORDING_MAX_HOURS) return { notify: false, reason: "too_late" };
  if (!c.contactHasActiveService) return { notify: false, reason: "no_active_service" };
  if (c.hasRecording) return { notify: false, reason: "has_recording" };
  if (!c.hostHasFathom) return { notify: false, reason: "no_fathom" };
  if (c.alreadyNotified) return { notify: false, reason: "already_notified" };
  return { notify: true };
}

/** Las agendas a las que hay que avisar, sin repetir. */
export function bookingsToNotify(candidates: readonly MissingRecordingCandidate[], now: Date): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (out.includes(c.bookingId)) continue;
    if (missingRecordingDecision(c, now).notify) out.push(c.bookingId);
  }
  return out;
}

/** La ventana de búsqueda (lo que el barrido le pide a la base). */
export function missingRecordingWindow(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - MISSING_RECORDING_MAX_HOURS * 3_600_000).toISOString(),
    to: new Date(now.getTime() - MISSING_RECORDING_MIN_HOURS * 3_600_000).toISOString(),
  };
}
