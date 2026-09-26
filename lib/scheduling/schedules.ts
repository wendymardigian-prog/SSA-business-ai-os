/**
 * Resumen legible de un horario (F10): "Lun a Vie, 9:00–12:00 y 14:00–18:00".
 */
import type { TimeRange, WeeklyHours, WeekdayKey } from "./types";
import { WEEKDAY_SHORT, WEEKDAY_KEYS } from "./availability-schema";
import { wallTimeToMinutes } from "./time/tz";

/** "09:00" → "9:00"; "24:00" → "24:00". Sin cero a la izquierda en la hora. */
export function shortTime(time: string): string {
  const [h, m] = time.split(":");
  return `${Number(h)}:${m}`;
}

function rangesKey(ranges: TimeRange[]): string {
  return [...ranges]
    .sort((a, b) => wallTimeToMinutes(a.start) - wallTimeToMinutes(b.start))
    .map((r) => `${r.start}-${r.end}`)
    .join("|");
}

function rangesLabel(ranges: TimeRange[]): string {
  const sorted = [...ranges].sort((a, b) => wallTimeToMinutes(a.start) - wallTimeToMinutes(b.start));
  return joinSpanish(sorted.map((r) => `${shortTime(r.start)}–${shortTime(r.end)}`));
}

/** ["a"] → "a"; ["a","b"] → "a y b"; ["a","b","c"] → "a, b y c". */
export function joinSpanish(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/**
 * Días (1..6, 0) agrupados en corridas consecutivas: [1,2,3,4,5] → "Lun a Vie";
 * [1,3,5] → "Lun, Mié y Vie"; [1,2,3,5] → "Lun a Mié y Vie".
 * Se ordenan de lunes a domingo.
 */
export function daysLabel(days: number[]): string {
  const order = (d: number) => (d + 6) % 7; // lunes = 0 … domingo = 6
  const sorted = [...new Set(days)].sort((a, b) => order(a) - order(b));
  const runs: number[][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && order(d) === order(last[last.length - 1]) + 1) last.push(d);
    else runs.push([d]);
  }
  return joinSpanish(
    runs.map((run) => {
      if (run.length === 1) return WEEKDAY_SHORT[run[0]];
      if (run.length === 2) return `${WEEKDAY_SHORT[run[0]]} y ${WEEKDAY_SHORT[run[1]]}`;
      return `${WEEKDAY_SHORT[run[0]]} a ${WEEKDAY_SHORT[run[run.length - 1]]}`;
    }),
  );
}

/**
 * Agrupa los días que tienen exactamente los mismos rangos y arma una frase
 * por grupo, separadas por " · ". Vacío: "Sin horarios".
 */
export function summarizeSchedule(weeklyHours: WeeklyHours): string {
  const groups = new Map<string, { days: number[]; ranges: TimeRange[] }>();
  for (const key of WEEKDAY_KEYS) {
    const ranges = weeklyHours[key as WeekdayKey];
    if (!ranges || ranges.length === 0) continue;
    const k = rangesKey(ranges);
    const g = groups.get(k);
    if (g) g.days.push(Number(key));
    else groups.set(k, { days: [Number(key)], ranges });
  }
  if (groups.size === 0) return "Sin horarios";
  // Orden: primero el grupo cuyo primer día (lunes = 0) es más temprano.
  const order = (d: number) => (d + 6) % 7;
  return [...groups.values()]
    .sort((a, b) => Math.min(...a.days.map(order)) - Math.min(...b.days.map(order)))
    .map((g) => `${daysLabel(g.days)}, ${rangesLabel(g.ranges)}`)
    .join(" · ");
}
