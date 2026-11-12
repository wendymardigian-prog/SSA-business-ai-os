// @plantilla-quitar(servicios)
/**
 * El bloque «Reuniones» de la ficha del servicio (Servicios A4, F137; decisión 479). PURA.
 *
 * Junta, como UN elemento por reunión, la agenda y su grabación (`calls.booking_id`):
 *   - las grabaciones con `service_id` = este servicio;
 *   - las agendas del contacto del área Servicio (sin tipo Clase) entre la creación del servicio y su fin, más las
 *     agendas con `utm.svc_item` de un paso de este servicio aunque caigan fuera de fecha.
 *
 * Estados: Agendada (futura), Sin grabación (terminó, sin grabación, no cancelada ni «no se presentó»), No se presentó,
 * Grabada (sin análisis), Analizada (con la nota), Cancelada (oculta por defecto).
 */
import { isServiceMeeting } from "@/lib/services/call-link";

export type MeetingState = "scheduled" | "missing_recording" | "no_show" | "recorded" | "analyzed" | "cancelled";

export const MEETING_STATE_LABEL: Record<MeetingState, string> = {
  scheduled: "Agendada",
  missing_recording: "Sin grabación",
  no_show: "No se presentó",
  recorded: "Grabada",
  analyzed: "Analizada",
  cancelled: "Cancelada",
};

export type MeetingBooking = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  title: string | null;
  hostUserId: string | null;
  areaKey: string | null;
  typeKey: string | null;
  typeLabel: string | null;
  /** El paso que trae la agenda (`utm.svc_item`), si es de este servicio. */
  itemOfThisService: boolean;
};

export type MeetingCall = {
  id: string;
  bookingId: string | null;
  recordedAt: string;
  title: string;
  recorderUserId: string | null;
  typeLabel: string | null;
  noShow: boolean;
  analysisStatus: string;
  score: number | null;
  serviceLink: string | null;
  pendingProposals: number;
};

export type MeetingRow = {
  key: string;
  at: string;
  typeLabel: string;
  hostUserId: string | null;
  state: MeetingState;
  score: number | null;
  callId: string | null;
  bookingId: string | null;
  pendingProposals: number;
  review: boolean;
};

export type ServiceWindow = { createdAt: string; endsOn: string | null };

/** Si la agenda entra en el bloque: del área Servicio (no Clase) y dentro del período, o con un paso de este servicio. */
export function bookingBelongs(b: MeetingBooking, w: ServiceWindow): boolean {
  if (b.itemOfThisService) return true;
  if (!isServiceMeeting(b.areaKey, b.typeKey)) return false;
  if (b.startAt < w.createdAt) return false;
  if (w.endsOn && b.startAt.slice(0, 10) > w.endsOn) return false;
  return true;
}

function bookingState(b: MeetingBooking, now: Date): MeetingState {
  if (b.status.startsWith("cancelled")) return "cancelled";
  if (b.status === "no_show") return "no_show";
  if (new Date(b.endAt).getTime() > now.getTime()) return "scheduled";
  return "missing_recording";
}

function callState(c: MeetingCall): MeetingState {
  if (c.noShow) return "no_show";
  return c.analysisStatus === "analyzed" ? "analyzed" : "recorded";
}

export function serviceMeetings(input: {
  calls: readonly MeetingCall[];
  bookings: readonly MeetingBooking[];
  window: ServiceWindow;
  now: Date;
  showCancelled?: boolean;
}): MeetingRow[] {
  const rows: MeetingRow[] = [];
  const bookingById = new Map(input.bookings.map((b) => [b.id, b]));
  const usedBookings = new Set<string>();
  for (const c of input.calls) {
    const b = c.bookingId ? bookingById.get(c.bookingId) : undefined;
    if (b) usedBookings.add(b.id);
    rows.push({
      key: `call:${c.id}`,
      at: b?.startAt ?? c.recordedAt,
      typeLabel: b?.typeLabel ?? c.typeLabel ?? c.title,
      hostUserId: b?.hostUserId ?? c.recorderUserId,
      state: callState(c),
      score: c.analysisStatus === "analyzed" ? c.score : null,
      callId: c.id,
      bookingId: c.bookingId,
      pendingProposals: c.pendingProposals,
      review: c.serviceLink === "review",
    });
  }
  for (const b of input.bookings) {
    if (usedBookings.has(b.id) || !bookingBelongs(b, input.window)) continue;
    rows.push({
      key: `booking:${b.id}`,
      at: b.startAt,
      typeLabel: b.typeLabel ?? b.title ?? "Reunión",
      hostUserId: b.hostUserId,
      state: bookingState(b, input.now),
      score: null,
      callId: null,
      bookingId: b.id,
      pendingProposals: 0,
      review: false,
    });
  }
  return rows
    .filter((r) => input.showCancelled || r.state !== "cancelled")
    .sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

/** Las 10 más recientes y si hay más (para «Ver todas en Grabaciones»). */
export function recentMeetings(rows: readonly MeetingRow[], limit = 10): { rows: MeetingRow[]; more: boolean } {
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}
