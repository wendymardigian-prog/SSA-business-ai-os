/**
 * Reglas de arrastre del kanban (F34), como funciones puras sobre F32.
 */
import type { Booking, BookingStatus } from "./types";
import { evaluateTransition, isCancelled, groupOf, TRANSITION_REASON_TEXT, CANCELLED_STATUSES } from "./booking-status";

export type DropEvaluation =
  | { ok: true; opensCancelModal: boolean }
  | { ok: false; reason: string };

/** ¿Se puede soltar en esa columna? Si no, el motivo con el que se revierte. */
export function evaluateDrop(booking: Pick<Booking, "status" | "start_at">, toStatus: BookingStatus, now: Date): DropEvaluation {
  const t = evaluateTransition(booking.status, toStatus, booking, now);
  if (!t.ok) return { ok: false, reason: TRANSITION_REASON_TEXT[t.reason ?? "not_allowed"] };
  return { ok: true, opensCancelModal: needsCancelModal(toStatus) };
}

/** Soltar en una columna de cancelación abre el modal de cancelar (motivo opcional). */
export function needsCancelModal(toStatus: BookingStatus): boolean {
  return groupOf(toStatus) === "cancelled";
}

/** Las tarjetas de las columnas de cancelación no se mueven. */
export function isDraggable(booking: Pick<Booking, "status">): boolean {
  return !isCancelled(booking.status);
}

/** Por defecto, las 3 columnas de cancelación quedan contraídas. */
export const DEFAULT_COLLAPSED_COLUMNS: BookingStatus[] = CANCELLED_STATUSES;

/** Las columnas de resultado, no-show y cancelación muestran los últimos N días. */
export const HISTORY_COLUMN_DAYS = 30;

export function isHistoryColumn(status: BookingStatus): boolean {
  return groupOf(status) !== "active";
}
