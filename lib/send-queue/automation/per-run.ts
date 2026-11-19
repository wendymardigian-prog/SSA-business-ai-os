/**
 * Límite de envíos por ejecución. PURO.
 *
 * Si una automatización alcanza a muchos contactos a la vez (por ejemplo, una etiqueta puesta a 300), la cola los separa con el espaciado. Una «vuelta» es una
 * hora de reloj: como mucho N envíos de la misma automatización entran en la cola del mismo número por hora; los que
 * sobran pasan a la hora siguiente (y así sucesivamente). El espaciado del carril sigue separando cada uno.
 * Sin límite (null), todos entran en la hora en curso. La caducidad cuenta desde la hora en la que le toca salir.
 */

/** El comienzo de la hora de reloj de `at` (UTC: las horas son las mismas en cualquier zona salvo las de media hora). */
export function hourStart(at: Date): Date {
  const d = new Date(at.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export function parsePerRunLimit(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  const v = Math.round(n);
  return v >= 1 && v <= 10_000 ? v : null;
}

/**
 * Cuándo puede salir el próximo envío de esta automatización por este número. `alreadyFromThisHour`: los que ya están
 * en la cola (de esta automatización y este número) con hora prevista desde el comienzo de la hora actual.
 */
export function perRunPlacement(limit: number | null, alreadyFromThisHour: number, now: Date): Date {
  if (limit === null || alreadyFromThisHour < limit) return now;
  const bucket = Math.floor(alreadyFromThisHour / limit);
  return new Date(hourStart(now).getTime() + bucket * 3_600_000);
}
