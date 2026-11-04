/**
 * «Esperar hasta» con hora de pared (hora del negocio): `AAAA-MM-DDTHH:mm`, sin zona. La zona la pone quien la lee: el
 * motor con `workspaces.timezone`, nunca la del navegador de quien armo el flujo. PURO (lo usan el servidor y el panel).
 */

/** Lo que devuelve el «Esperar» cuando su fecha ya paso: el motor saltea el paso siguiente y sigue con el que viene. */
export const SKIP_NEXT_STEP = "skip_next";

export interface LocalDateTime {
  date: string;
  time: string;
}

/** `AAAA-MM-DDTHH:mm` -> fecha y hora, o null si no es una fecha real (un 31 de febrero, las 25:00). */
export function parseLocalDateTime(value: string): LocalDateTime | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [y, m, d, hh, mm] = match.slice(1).map(Number);
  if (hh > 23 || mm > 59) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { date: value.trim().slice(0, 10), time: value.trim().slice(11) };
}

/** "7 nov 2026, 10:00": la hora tal como se escribio, sin pasarla por la zona de quien mira. */
export function formatLocalDateTime(value: string): string | null {
  const parsed = parseLocalDateTime(value);
  if (!parsed) return null;
  const [y, m, d] = parsed.date.split("-").map(Number);
  const [hh, mm] = parsed.time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm)).toLocaleString("es", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
