/**
 * El numerito de la campana.
 *
 * PURO. La campana nunca muestra más que «9+», así que contar todos los avisos
 * sin leer era trabajo tirado: la RLS (`can_see_notification`) se evalúa fila
 * por fila, y con cientos de avisos sin leer el conteo exacto costaba más de
 * 100 ms en CADA carga de página (8/11/2026). Ahora se piden, como mucho,
 * `BELL_COUNT_CAP` filas: alcanza para saber si hay que mostrar «9+».
 *
 * Qué avisos ve cada persona no cambia: lo decide la RLS y `bell-filter.ts`.
 */

/** Lo más alto que muestra el numerito antes del «+». */
export const BELL_BADGE_MAX = 9;

/** Cuántas filas se leen para contar: una más de lo que se muestra. */
export const BELL_COUNT_CAP = BELL_BADGE_MAX + 1;

/** Lo que dice el numerito: `0` no se dibuja; de 1 a 9 el número; desde 10, «9+». */
export function bellBadgeText(unread: number): string {
  return unread > BELL_BADGE_MAX ? `${BELL_BADGE_MAX}+` : String(Math.max(0, unread));
}

/** El texto para lectores de pantalla, con el mismo tope que el numerito. */
export function bellAriaLabel(unread: number): string {
  if (unread <= 0) return "Notificaciones, ninguna sin leer";
  if (unread > BELL_BADGE_MAX) return `Notificaciones, más de ${BELL_BADGE_MAX} sin leer`;
  return `Notificaciones, ${unread} sin leer`;
}
