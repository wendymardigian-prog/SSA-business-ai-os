/**
 * La rejilla del calendario de Agenda: a que minuto del dia cae un punto donde se solto algo (una agenda o una tarea).
 * PURO. Antes vivia en lib/tasks/calendar-drag.ts; se mudo porque el arrastre de agendas tambien la usa.
 */

/** Los pasos de la rejilla: 15 minutos. */
export const SNAP_MINUTES = 15;

/**
 * Minutos desde la medianoche a los que cae un punto de la rejilla, ajustado al paso. `offsetY` son los pixeles desde el
 * borde de arriba de la columna del dia (donde empieza `firstHour`). Queda dentro del dia.
 */
export function snapMinutes(offsetY: number, hourPx: number, firstHour: number, step: number = SNAP_MINUTES): number {
  const raw = firstHour * 60 + (offsetY / hourPx) * 60;
  const snapped = Math.round(raw / step) * step;
  return Math.max(0, Math.min(24 * 60 - step, snapped));
}
