/**
 * Arrastrar una agenda a otra hora o dia, siempre con confirmacion (Tareas × CRM, R8). PURO.
 *
 * Soltar una agenda NO la reagenda: abre un modal y nada se guarda hasta que la persona confirma. Aca esta lo que decide
 * a que instante apunta el destino y la maquina de estados del modal (`dragConfirmReducer`), que garantiza que ninguna
 * transicion llega a «confirmando» (que es cuando se llama a la accion) sin pasar antes por «pendiente» y una confirmacion
 * explicita.
 */

import { minutesToTime } from "@/lib/calendar/time";
import { minutesOfDayInTz, wallClockToUtc } from "./time/tz";
import type { WallTime } from "./types";

/** Donde se solto: una hora de la rejilla (dia o semana) o una celda del mes. */
export type BookingDrop = { kind: "slot"; date: string; minutes: number } | { kind: "day"; date: string };

/**
 * El instante (UTC, ISO) al que apunta el destino, en la zona de quien mira el calendario.
 *  - Rejilla: la fecha y los minutos exactos del destino.
 *  - Mes: cambia el dia y conserva la hora que la agenda ya tenia (en la zona de quien mira).
 * La duracion no se toca: la conserva el reagendado (`start + duracion del evento`).
 */
export function bookingDropToStartUtc(drop: BookingDrop, viewerTz: string, currentStartUtc: string): string {
  const minutes = drop.kind === "slot" ? drop.minutes : minutesOfDayInTz(currentStartUtc, viewerTz);
  return wallClockToUtc(drop.date, minutesToTime(minutes) as WallTime, viewerTz).toISOString();
}

/** Si el destino es el mismo instante que ya tenia (soltar en el mismo lugar no hace nada). */
export function isSameStart(startUtc: string, currentStartUtc: string): boolean {
  return new Date(startUtc).getTime() === new Date(currentStartUtc).getTime();
}

// ── Errores de `rescheduleAsHost` ─────────────────────────────────────────────────────────────────────────────────

/** Los textos EXACTOS que devuelve el reagendado; `booking-drag.test.ts` los fija (si cambian, el modal se entera). */
export const RESCHEDULE_MESSAGES = {
  outsideAvailability: "Ese horario ya no está disponible.",
  taken: "Ese horario se acaba de ocupar.",
  cancelled: "Una reunión cancelada no se reagenda.",
} as const;

/**
 * Que tipo de rechazo es. Solo `outside_availability` ofrece «Reagendar igual»: un choque con otra agenda (`taken`) lo
 * impide la base y ignorar la disponibilidad no lo salta.
 */
export function classifyRescheduleError(message: string | null | undefined): "outside_availability" | "taken" | "cancelled" | "other" {
  if (message === RESCHEDULE_MESSAGES.outsideAvailability) return "outside_availability";
  if (message === RESCHEDULE_MESSAGES.taken) return "taken";
  if (message === RESCHEDULE_MESSAGES.cancelled) return "cancelled";
  return "other";
}

// ── La maquina de estados del modal ───────────────────────────────────────────────────────────────────────────────

interface Pending {
  bookingId: string;
  drop: BookingDrop;
  /** El instante nuevo, ya calculado. */
  startUtc: string;
  reason: string;
  /** La casilla «Reagendar igual (ignorar la disponibilidad)». */
  ignoreAvailability: boolean;
}

export type DragConfirmState =
  | { phase: "idle" }
  | ({ phase: "pending" } & Pending)
  | ({ phase: "confirming" } & Pending)
  | ({ phase: "error"; error: string; offerIgnore: boolean } & Pending)
  | { phase: "done"; bookingId: string };

export type DragConfirmEvent =
  | { type: "drop"; bookingId: string; drop: BookingDrop; startUtc: string }
  | { type: "reason"; value: string }
  | { type: "ignoreAvailability"; value: boolean }
  | { type: "confirm" }
  | { type: "succeeded" }
  | { type: "failed"; error: string }
  | { type: "cancel" };

const pendingOf = (s: Pending): Pending => ({ bookingId: s.bookingId, drop: s.drop, startUtc: s.startUtc, reason: s.reason, ignoreAvailability: s.ignoreAvailability });

export function dragConfirmReducer(state: DragConfirmState, event: DragConfirmEvent): DragConfirmState {
  switch (event.type) {
    case "drop":
      // Soltar abre el modal. Con una llamada en vuelo no se acepta otro destino.
      if (state.phase === "confirming") return state;
      return { phase: "pending", bookingId: event.bookingId, drop: event.drop, startUtc: event.startUtc, reason: "", ignoreAvailability: false };

    case "reason":
      return state.phase === "pending" || state.phase === "error" ? { ...state, reason: event.value } : state;

    case "ignoreAvailability":
      return state.phase === "pending" || state.phase === "error" ? { ...state, ignoreAvailability: event.value } : state;

    case "confirm":
      // Solo se confirma desde «pendiente» o «error» (reintento): nunca desde «idle» ni «done».
      if (state.phase === "pending" || state.phase === "error") return { phase: "confirming", ...pendingOf(state) };
      return state;

    case "succeeded":
      return state.phase === "confirming" ? { phase: "done", bookingId: state.bookingId } : state;

    case "failed":
      if (state.phase !== "confirming") return state;
      return { phase: "error", ...pendingOf(state), error: event.error, offerIgnore: classifyRescheduleError(event.error) === "outside_availability" };

    case "cancel":
      // Esc, clic afuera o «Cancelar»: vuelve a idle sin efectos. Con la llamada en vuelo no se puede cancelar.
      return state.phase === "confirming" ? state : { phase: "idle" };
  }
}

/** Si pasar de `prev` a `next` es el momento de llamar a la accion: solo al ENTRAR a «confirmando». */
export function shouldCallAction(prev: DragConfirmState, next: DragConfirmState): boolean {
  return next.phase === "confirming" && prev.phase !== "confirming";
}

// ── El texto del modal ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lo que de verdad pasa al reagendar (`lib/scheduling/booking/reschedule.ts`), en palabras: la agenda conserva su
 * duracion y queda «Reagenda»; si esta en Google Calendar, Google actualiza el evento y le avisa al invitado; los
 * recordatorios pendientes se mueven al horario nuevo; el aviso por email solo sale si el negocio publico la automatizacion
 * «Aviso de reagendamiento» (viene apagada de fabrica); queda en el historial. No promete nada mas.
 */
export function rescheduleEffects(syncStatus: string): string[] {
  const effects = ["La agenda conserva su duración y queda en estado «Reagenda»."];
  if (syncStatus === "not_applicable") {
    effects.push("Esta agenda no está en Google Calendar: ahí no hay nada para actualizar ni avisar.");
  } else {
    effects.push("Si está en Google Calendar, Google actualiza el evento y le avisa al invitado del cambio.");
  }
  effects.push("Los recordatorios que estaban pendientes se mueven al horario nuevo.");
  effects.push("Si tu negocio publicó la automatización «Aviso de reagendamiento», el invitado también recibe ese email.");
  effects.push("Queda registrado en el historial de la agenda.");
  return effects;
}
