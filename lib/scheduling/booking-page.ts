/**
 * La pagina del invitado (F27, F28): que muestra y que puede hacer.
 *
 * Puro: recibe la agenda y `now`, y decide. Las reglas son las del plano:
 *   - No hay limites para cancelar ni reagendar, pero una vez que la reunion
 *     EMPEZO ya no se toca.
 *   - Cancelar es final: una agenda cancelada no se reagenda. Para volver a
 *     verse hay que agendar de nuevo.
 *   - Una agenda con resultado o no-show ya paso: tampoco se toca.
 */

import type { Booking } from "./types";
import { groupOf } from "./booking-status";

export type BookingPageState =
  /** Activa y todavia no empezo: se puede cancelar y reagendar. */
  | "upcoming"
  /** Activa, ya empezo (o ya termino): solo se muestra. */
  | "started"
  | "cancelled"
  /** No-show o con resultado: la reunion ya pasó. */
  | "past";

export interface InviteeActions {
  state: BookingPageState;
  canCancel: boolean;
  canReschedule: boolean;
  canAddToCalendar: boolean;
  /** El motivo, para el texto de la pagina. */
  reason: string | null;
}

export type BookingForPage = Pick<Booking, "status" | "start_at" | "end_at" | "cancelled_at" | "cancelled_by_type" | "cancellation_reason">;

export function bookingPageState(booking: BookingForPage, now: Date = new Date()): BookingPageState {
  const group = groupOf(booking.status);
  if (group === "cancelled") return "cancelled";
  if (group === "no_show" || group === "outcome") return "past";
  return new Date(booking.start_at).getTime() <= now.getTime() ? "started" : "upcoming";
}

export function inviteeActions(booking: BookingForPage, now: Date = new Date()): InviteeActions {
  const state = bookingPageState(booking, now);
  if (state === "upcoming") {
    return { state, canCancel: true, canReschedule: true, canAddToCalendar: true, reason: null };
  }
  if (state === "cancelled") {
    return { state, canCancel: false, canReschedule: false, canAddToCalendar: false, reason: "Esta reunión está cancelada." };
  }
  if (state === "started") {
    const ended = new Date(booking.end_at).getTime() <= now.getTime();
    return {
      state,
      canCancel: false,
      canReschedule: false,
      canAddToCalendar: !ended,
      reason: ended ? "Esta reunión ya pasó." : "Esta reunión ya empezó.",
    };
  }
  return { state, canCancel: false, canReschedule: false, canAddToCalendar: false, reason: "Esta reunión ya pasó." };
}

/** Quien cancelo, en palabras, para la pagina del invitado. */
export function cancelledByText(booking: Pick<Booking, "cancelled_by_type">, hostName: string): string {
  switch (booking.cancelled_by_type) {
    case "invitee":
      return "La cancelaste vos.";
    case "host":
      return `La canceló ${hostName}.`;
    case "system":
      return "La canceló el sistema.";
    default:
      return "Está cancelada.";
  }
}

/** El texto del error cuando una accion del invitado llega tarde. */
export const LATE_ACTION_MESSAGE: Record<"cancel" | "reschedule", string> = {
  cancel: "Ya no se puede cancelar desde acá: la reunión empezó o está cancelada.",
  reschedule: "Ya no se puede reagendar desde acá: la reunión empezó o está cancelada.",
};
