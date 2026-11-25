// @plantilla-quitar(servicios)
/**
 * La repetición de un paso del camino (00522, traído de RER #70 y adaptado a SSA). Módulo PURO: lo usan el editor,
 * la ficha del servicio y la tarea de cada vuelta.
 *
 * La regla vive en `recurrence` (la forma de SSA desde la 00376: `every`, `n`, `from`, `until`, `n_until`, `max_days`,
 * y desde la 00522 `weekdays` y `day_of_month`). Las fechas las calcula `occurrenceDates` (engine-rules.ts).
 *
 * Gemela en SQL: `seriesReached` ↔ `app_servicio.svc_series_reached`, con los casos de `repetition.cases.json`.
 */

export const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
export const WEEKDAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** «Después de N vueltas» cuenta las CUMPLIDAS: con N cumplidas, la serie termina. */
export function seriesReached(recurrence: unknown, completed: number): boolean {
  if (!isObj(recurrence) || recurrence.until !== "n_times") return false;
  const n = isInt(recurrence.n_until) ? Math.max(1, recurrence.n_until) : 1;
  return (completed || 0) >= n;
}

function joinDays(days: number[]): string {
  const names = days.map((d) => WEEKDAY_NAMES[d - 1]).filter(Boolean);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** Cada cuánto, en palabras: «Cada 2 semanas, los lunes y jueves». */
export function describeEvery(recurrence: unknown): string {
  if (!isObj(recurrence)) return "";
  const n = isInt(recurrence.n) ? recurrence.n : null;
  const days = Array.isArray(recurrence.weekdays) ? (recurrence.weekdays.filter((d) => isInt(d) && d >= 1 && d <= 7) as number[]).sort((a, b) => a - b) : [];
  const onDays = days.length ? `, los ${joinDays(days)}` : "";
  switch (recurrence.every) {
    case "day":
      return "Cada día";
    case "week":
      return `Cada semana${onDays}`;
    case "n_weeks":
      return n && n > 1 ? `Cada ${n} semanas${onDays}` : `Cada semana${onDays}`;
    case "month":
      return isInt(recurrence.day_of_month) ? `Cada mes, el día ${recurrence.day_of_month}` : "Cada mes";
    case "n_days":
      return n && n > 1 ? `Cada ${n} días` : "Cada día";
    default:
      return "";
  }
}

/** Hasta cuándo, en palabras. */
export function describeUntil(recurrence: unknown): string {
  if (!isObj(recurrence)) return "";
  const n = isInt(recurrence.n_until) ? recurrence.n_until : null;
  switch (recurrence.until) {
    case "phase_end":
      return recurrence.phase_key ? "hasta que termina otra fase" : "hasta que termina su fase";
    case "service_end":
      return "hasta que termina el servicio";
    case "n_days":
      return n ? `durante ${n} ${n === 1 ? "día" : "días"}` : "";
    case "n_times":
      return n ? `hasta ${n} ${n === 1 ? "vuelta cumplida" : "vueltas cumplidas"}` : "";
    case "item_completed":
      return "hasta que se completa otro paso";
    default:
      return "";
  }
}

/** La regla entera, en una línea: «Cada semana, los lunes · hasta que termina su fase». */
export function describeRepetition(recurrence: unknown): string {
  return [describeEvery(recurrence), describeUntil(recurrence)].filter(Boolean).join(" · ");
}

export const SERIES_END_LABEL: Record<string, string> = {
  manual: "Se terminó a mano",
  service_end: "Terminó con el servicio",
  n_times: "Cumplió sus vueltas",
};
