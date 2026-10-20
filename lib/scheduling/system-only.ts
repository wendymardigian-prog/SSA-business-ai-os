/**
 * Un evento "solo en el sistema" (decisión del 20/10/2026): no tiene un
 * calendario destino que funcione. Sus reuniones se guardan y se protegen de
 * dobles reservas dentro del sistema, pero no se crean en Google.
 *
 * El destino efectivo es el del evento o, si no eligió, el por defecto del
 * perfil de su dueño (la misma regla que `resolveEventCalendars`). Por eso un
 * evento creado sin calendario se vincula SOLO al conectar Google: la conexión
 * le pone un calendario por defecto al perfil.
 */
export function effectiveDestinationId(
  event: { destination_calendar_id: string | null },
  profileDefaultDestinationId: string | null | undefined,
): string | null {
  return event.destination_calendar_id ?? profileDefaultDestinationId ?? null;
}

export function isSystemOnly(
  event: { destination_calendar_id: string | null },
  profileDefaultDestinationId: string | null | undefined,
  activeCalendarIds: ReadonlySet<string>,
): boolean {
  const id = effectiveDestinationId(event, profileDefaultDestinationId);
  return !id || !activeCalendarIds.has(id);
}
