/**
 * Una fecha `YYYY-MM-DD` válida, sin dayjs.
 *
 * Vive acá y no en `tz.ts` porque la usa el script de embed, que se compila
 * aparte para la página de cualquiera: importar `tz.ts` le metía dayjs entero
 * al bundle (26 KB por una validación de diez líneas).
 *
 * "Válida" quiere decir que existe: `2026-02-30` tiene la forma correcta y no
 * es una fecha, y eso se ve porque el Date que se arma cae en otro día.
 */

import type { DateString } from "../types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value: unknown): value is DateString {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
