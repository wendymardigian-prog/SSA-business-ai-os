/**
 * Catálogo de estados de agenda (F32), definido por Wendy. Cada estado tiene
 * clave, etiqueta, color, orden y grupo; el sistema decide por el grupo.
 *
 * `BOOKING_STATUS_KEYS` es la lista canónica: la Tanda B la compara con el
 * CHECK de `bookings.status` en un test, y el CASE de la columna calculada
 * `status_group` sale de `groupOf`.
 */
import type { Booking, BookingStatus, StatusGroup } from "./types";

export interface BookingStatusDef {
  key: BookingStatus;
  label: string;
  /** Color de referencia para chips y columnas (clase de Tailwind sin prefijo, ej. "blue"). */
  color: string;
  order: number;
  group: StatusGroup;
}

export const BOOKING_STATUSES: BookingStatusDef[] = [
  { key: "scheduled", label: "Agendada", color: "blue", order: 1, group: "active" },
  { key: "confirmed", label: "Confirmada", color: "green", order: 2, group: "active" },
  { key: "rescheduled", label: "Reagenda", color: "sky", order: 3, group: "active" },
  { key: "no_show", label: "No-show", color: "orange", order: 4, group: "no_show" },
  { key: "followup_warm", label: "Seguimiento tibio", color: "amber", order: 5, group: "outcome" },
  { key: "followup_cold", label: "Seguimiento frío", color: "slate", order: 6, group: "outcome" },
  { key: "sale", label: "Venta", color: "emerald", order: 7, group: "outcome" },
  { key: "not_qualified", label: "No califica", color: "zinc", order: 8, group: "outcome" },
  { key: "cancelled_not_qualified", label: "Cancelada – no califica", color: "rose", order: 9, group: "cancelled" },
  { key: "cancelled_no_response", label: "Cancelada – no contesta", color: "rose", order: 10, group: "cancelled" },
  { key: "cancelled_other", label: "Cancelada – otro", color: "rose", order: 11, group: "cancelled" },
];

export const BOOKING_STATUS_KEYS: BookingStatus[] = BOOKING_STATUSES.map((s) => s.key);

export const STATUS_GROUPS: StatusGroup[] = ["active", "no_show", "outcome", "cancelled"];

export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  active: "Activas",
  no_show: "No-show",
  outcome: "Con resultado",
  cancelled: "Canceladas",
};

const BY_KEY = new Map(BOOKING_STATUSES.map((s) => [s.key, s]));

export function statusDef(status: BookingStatus): BookingStatusDef {
  const def = BY_KEY.get(status);
  if (!def) throw new Error(`Estado de agenda desconocido: ${status}`);
  return def;
}

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === "string" && BY_KEY.has(value as BookingStatus);
}

export function groupOf(status: BookingStatus): StatusGroup {
  return statusDef(status).group;
}

export function statusLabel(status: BookingStatus): string {
  return statusDef(status).label;
}

/** Los estados de un grupo, en orden. */
export function statusesInGroup(group: StatusGroup): BookingStatus[] {
  return BOOKING_STATUSES.filter((s) => s.group === group).map((s) => s.key);
}

/** Solo los estados activos ocupan el horario (exclusión en la base). */
export const ACTIVE_STATUSES: BookingStatus[] = statusesInGroup("active");
export const CANCELLED_STATUSES: BookingStatus[] = statusesInGroup("cancelled");
export const OUTCOME_STATUSES: BookingStatus[] = statusesInGroup("outcome");

export function isActive(status: BookingStatus): boolean {
  return groupOf(status) === "active";
}

export function isCancelled(status: BookingStatus): boolean {
  return groupOf(status) === "cancelled";
}

export type TransitionReason =
  | "same_status"
  | "cancelled_is_final"
  | "not_started_yet"
  | "not_allowed";

export const TRANSITION_REASON_TEXT: Record<TransitionReason, string> = {
  same_status: "La agenda ya está en ese estado",
  cancelled_is_final: "Una agenda cancelada no se puede reabrir: agendá de nuevo",
  not_started_yet: "El resultado se carga después de la hora de inicio",
  not_allowed: "Ese cambio de estado no está permitido",
};

export interface TransitionResult {
  ok: boolean;
  reason: TransitionReason | null;
}

function hasStarted(booking: Pick<Booking, "start_at">, now: Date): boolean {
  return Date.parse(booking.start_at) <= now.getTime();
}

/**
 * Reglas de transición de F32:
 * - active → cualquier active o cancelled, en cualquier momento.
 * - active → no_show u outcome, solo si la hora de inicio ya pasó.
 * - no_show ↔ outcome y outcome ↔ outcome (corrección), sin límite.
 * - no_show / outcome → confirmed (corrección "todavía no se hizo"); la
 *   exclusión de la base garantiza que el horario siga libre.
 * - cancelled es final.
 */
export function evaluateTransition(
  from: BookingStatus,
  to: BookingStatus,
  booking: Pick<Booking, "start_at">,
  now: Date,
): TransitionResult {
  if (from === to) return { ok: false, reason: "same_status" };
  const fromGroup = groupOf(from);
  const toGroup = groupOf(to);

  if (fromGroup === "cancelled") return { ok: false, reason: "cancelled_is_final" };

  if (fromGroup === "active") {
    if (toGroup === "active" || toGroup === "cancelled") return { ok: true, reason: null };
    // no_show u outcome: solo después del inicio.
    return hasStarted(booking, now) ? { ok: true, reason: null } : { ok: false, reason: "not_started_yet" };
  }

  // from es no_show u outcome.
  if (toGroup === "no_show" || toGroup === "outcome") return { ok: true, reason: null };
  if (to === "confirmed") return { ok: true, reason: null };
  if (toGroup === "cancelled") return { ok: true, reason: null };
  return { ok: false, reason: "not_allowed" };
}

export function canTransition(from: BookingStatus, to: BookingStatus, booking: Pick<Booking, "start_at">, now: Date): boolean {
  return evaluateTransition(from, to, booking, now).ok;
}

/** Los estados a los que se puede pasar desde el actual, en el orden del catálogo (menú del chip, F33/F36). */
export function allowedTransitions(booking: Pick<Booking, "start_at" | "status">, now: Date): BookingStatus[] {
  return BOOKING_STATUS_KEYS.filter((to) => canTransition(booking.status, to, booking, now));
}
