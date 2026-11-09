/**
 * El horario de envío de un paso de WhatsApp. PURO.
 *
 * Un paso puede mandar «solo entre las 08:00 y las 21:00» (hora del NEGOCIO, `workspaces.timezone`). Si le toca salir
 * fuera de ese horario no falla ni se pierde: el motor lo deja para cuando abre la ventana (`deferFlowNode`, el mismo
 * mecanismo que la guardia de entrega de los emails) y lo vuelve a correr entonces, sin repetir nada.
 *
 * Se guarda plano en los datos del paso (`windowEnabled`, `windowFrom`, `windowTo`) para que el lienzo lo edite sin
 * objetos anidados. Sin `windowEnabled` el paso sale siempre a la hora que le toca, igual que antes.
 *
 * Reglas: la hora de inicio es anterior a la de fin (no hay ventanas que crucen la medianoche: «de 21:00 a 08:00» se
 * arma al revés, con el horario en que SÍ se puede mandar). El fin no se incluye: con «08:00 a 21:00», a las 21:00 en
 * punto ya está cerrado.
 */

import { addDays, dateInTz, isValidWallTime, minutesOfDayInTz, wallClockToUtc, wallTimeToMinutes } from "@/lib/scheduling/time/tz";

export interface SendWindowData {
  windowEnabled?: boolean;
  /** `HH:mm`, hora del negocio. */
  windowFrom?: string;
  windowTo?: string;
}

export interface SendWindow {
  from: string;
  to: string;
}

export const DEFAULT_SEND_WINDOW: SendWindow = { from: "08:00", to: "21:00" };

export const WINDOW_ORDER_PROBLEM = "El horario de envío no es válido: la hora de inicio tiene que ser anterior a la de fin.";
export const WINDOW_TIME_PROBLEM = "El horario de envío no es válido: escribí las horas como 08:00 y 21:00.";

/** Qué está mal en el horario del paso, o null. Solo se mira si está prendido. */
export function sendWindowProblem(data: SendWindowData | null | undefined): string | null {
  if (!data?.windowEnabled) return null;
  const from = data.windowFrom ?? DEFAULT_SEND_WINDOW.from;
  const to = data.windowTo ?? DEFAULT_SEND_WINDOW.to;
  if (!isValidWallTime(from) || !isValidWallTime(to)) return WINDOW_TIME_PROBLEM;
  if (wallTimeToMinutes(from) >= wallTimeToMinutes(to)) return WINDOW_ORDER_PROBLEM;
  return null;
}

/** El horario del paso, o null si no tiene uno (apagado) o está mal armado (el paso sale como siempre). */
export function sendWindowOf(data: SendWindowData | null | undefined): SendWindow | null {
  if (!data?.windowEnabled) return null;
  if (sendWindowProblem(data)) return null;
  return { from: data.windowFrom ?? DEFAULT_SEND_WINDOW.from, to: data.windowTo ?? DEFAULT_SEND_WINDOW.to };
}

/**
 * Cuándo abre la ventana si ahora está cerrada; null si ahora se puede mandar.
 * Antes de la hora de inicio: hoy a esa hora. Desde la de fin en adelante: mañana a la hora de inicio.
 */
export function windowOpening(now: Date, tz: string, window: SendWindow): Date | null {
  const minutes = minutesOfDayInTz(now, tz);
  const from = wallTimeToMinutes(window.from);
  const to = wallTimeToMinutes(window.to);
  if (minutes >= from && minutes < to) return null;
  const today = dateInTz(now, tz);
  return wallClockToUtc(minutes < from ? today : addDays(today, 1), window.from, tz);
}
