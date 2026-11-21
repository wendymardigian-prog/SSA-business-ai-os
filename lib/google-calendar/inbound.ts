/**
 * Qué hacer con un cambio de Google Calendar (00430). Pura: sin base ni red.
 *
 * Cada evento tiene un solo dueño:
 *   - un evento creado por la plataforma (su id está en `bookings.google_event_id`, en el calendario de quien
 *     atiende) lo manda la plataforma, pero si quien atiende lo mueve o lo cancela en Google, se refleja acá;
 *   - un evento propio de Google no se importa nunca: solo cuenta como ocupado (freeBusy, `slots-input.ts`).
 *
 * Para no hacer eco: si la hora de Google ya es la de la reunión, no se hace nada; si la plataforma tiene un cambio
 * propio todavía sin mandar a Google (un job `booking_google_sync` pendiente), gana la plataforma.
 */
import type { GoogleEventChange } from "./client";

export interface InboundBooking {
  id: string;
  start_at: string;
  end_at: string;
  status_group: string;
}

export type InboundDecision =
  | { kind: "ignore"; reason: "same_time" | "already_cancelled" | "pending_platform_change" | "all_day" | "bad_range" }
  | { kind: "move"; startUtc: string; durationMinutes: number }
  | { kind: "cancel" };

/** Lo mismo que se acepta al estirar una reunión en el calendario: de 15 minutos a 8 horas. */
const MIN_MINUTES = 15;
const MAX_MINUTES = 8 * 60;

export function decideInbound(
  event: Pick<GoogleEventChange, "id" | "status" | "startUtc" | "endUtc">,
  booking: InboundBooking,
  opts: { pendingPlatformSync: boolean },
): InboundDecision {
  if (booking.status_group === "cancelled") return { kind: "ignore", reason: "already_cancelled" };
  if (opts.pendingPlatformSync) return { kind: "ignore", reason: "pending_platform_change" };

  if (event.status === "cancelled") return { kind: "cancel" };

  if (!event.startUtc || !event.endUtc) return { kind: "ignore", reason: "all_day" };
  const startMs = Date.parse(event.startUtc);
  const endMs = Date.parse(event.endUtc);
  const minutes = Math.round((endMs - startMs) / 60_000);
  if (!Number.isFinite(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) return { kind: "ignore", reason: "bad_range" };

  if (startMs === Date.parse(booking.start_at) && endMs === Date.parse(booking.end_at)) {
    return { kind: "ignore", reason: "same_time" };
  }
  return { kind: "move", startUtc: new Date(startMs).toISOString(), durationMinutes: minutes };
}

/** Desde cuándo se lee la primera vez (o tras un 410): un día atrás, para no traer el historial entero. */
export function fullSyncFrom(now: Date): string {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 00510: hasta dónde hacia atrás la ida y vuelta toca reuniones. La copia de la Agenda lee 60 días atrás, pero una
 * reunión que terminó hace más de 24 h no se mueve ni se cancela por lo que diga Google (el 19/11/2026 una lectura
 * canceló una reunión vieja y disparó sus automatizaciones). Mismo horizonte que encola la 00430.
 */
export const RECONCILE_HORIZON_MS = 24 * 60 * 60 * 1000;

export function withinReconcileHorizon(bookingEndAt: string, now: Date): boolean {
  const end = Date.parse(bookingEndAt);
  return Number.isFinite(end) && end >= now.getTime() - RECONCILE_HORIZON_MS;
}
