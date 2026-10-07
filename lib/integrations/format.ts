/**
 * Formateo de fechas para la card y el detalle de una integracion (G2, G3).
 *
 * Son funciones puras y chicas a proposito: `integrationStatus()` es quien
 * decide "vence en N dias" (la cuenta que importa para el estado); esto solo
 * pone una fecha en palabras para que la persona la vea, sin volver a contar
 * dias por su cuenta.
 */

function longDate(iso: string, now: Date, timeZone: string): string {
  const date = new Date(iso);
  const sameYear = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(date)
    === new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(now);
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "numeric",
    month: "long",
    year: sameYear ? undefined : "numeric",
  }).format(date);
}

/** "12 de agosto", sin ningun verbo antepuesto. Para componerla en otro texto (Actividad, G5). */
export function formatLongDate(iso: string | null | undefined, timeZone: string, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return longDate(iso, now, timeZone);
}

/** "Conectada desde el 12 de agosto". `null` si no hay fecha. */
export function formatConnectedSince(iso: string | null | undefined, timeZone: string, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `Conectada desde el ${longDate(iso, now, timeZone)}`;
}

/** "Vence el 12 de agosto". `null` si el token no vence (caso normal de Google). */
export function formatOAuthExpiry(iso: string | null | undefined, timeZone: string, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `Vence el ${longDate(iso, now, timeZone)}`;
}

/** "Renovada el 1 de agosto". `null` si todavia no se renovo nunca. */
export function formatLastRefreshed(iso: string | null | undefined, timeZone: string, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `Renovada el ${longDate(iso, now, timeZone)}`;
}
