/**
 * Hora y duracion de una tarea (Tareas × CRM, R6). PURO.
 *
 * Una tarea es solo fecha; la hora se agrega a proposito. `due_time` es una hora de pared de la zona del workspace (sin
 * fecha ni zona), `duration_minutes` va de 5 a 1440. La base devuelve la hora como `HH:MM:SS`; aca se normaliza a `HH:MM`.
 */

export type TimeFormat = "12h" | "24h";

export const DURATION_MIN = 5;
export const DURATION_MAX = 1440;
/**
 * Lo que el drawer ofrece: de 15 minutos a 8 horas. Vacio = sin duracion (el calendario la dibuja de 30 minutos).
 * Una duracion que ya estaba guardada y no esta en la lista (por ejemplo 90) se conserva y se muestra igual.
 */
export const DURATION_OPTIONS = [15, 30, 45, 60, 120, 180, 240, 300, 360, 420, 480] as const;
/** Cuanto dura una tarea con hora y sin duracion cuando se dibuja en el calendario. */
export const DEFAULT_DURATION_MINUTES = 30;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/;

/** `HH:MM` o `HH:MM:SS`. */
export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

/** `14:30:00` -> `14:30`; null/vacio/invalida -> null. */
export function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = TIME_RE.exec(value);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Minutos desde la medianoche (`14:30` -> 870). */
export function timeToMinutes(value: string | null | undefined): number | null {
  const t = normalizeTime(value);
  return t === null ? null : Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

/** Minutos desde la medianoche a `HH:MM` (0..1439; se acota). */
export function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function isValidDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= DURATION_MIN && value <= DURATION_MAX;
}

/** «14:30» (24 h) o «2:30 p. m.» (12 h). Sin hora valida, texto vacio. */
export function formatTime(value: string | null | undefined, timeFormat: TimeFormat): string {
  const t = normalizeTime(value);
  if (t === null) return "";
  if (timeFormat === "24h") return t;
  const h = Number(t.slice(0, 2));
  const suffix = h >= 12 ? "p. m." : "a. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${t.slice(3, 5)} ${suffix}`;
}

/** «30 min», «1 h», «1 h 30 min». */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !isValidDuration(minutes)) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}
