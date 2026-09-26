/**
 * Validación de `weekly_hours` y `date_overrides` (F9, F11, F12).
 *
 * La misma función corre en el cliente (para marcar el día con error mientras
 * se edita) y en la Server Action (para no guardar nada inválido). Los
 * esquemas Zod dan la forma; `validateWeeklyHours` y `validateOverrides`
 * agregan las reglas que Zod no expresa bien: fin mayor que inicio y sin
 * superposición dentro del mismo día.
 */
import { z } from "zod";
import type { DateOverride, TimeRange, WeeklyHours, WeekdayKey } from "./types";
import { addDays, isValidDateString, isValidWallTime, wallTimeToMinutes } from "./time/tz";

export const WEEKDAY_KEYS: WeekdayKey[] = ["0", "1", "2", "3", "4", "5", "6"];

/** Nombres cortos en español, índice = día (0 = domingo). */
export const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;
export const WEEKDAY_LONG = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

const wallTime = z.string().refine(isValidWallTime, "Hora inválida, usá HH:mm");

/**
 * Un rango. `"00:00"` como fin se lee como fin del día (F11) y se normaliza
 * a `"24:00"`, que es lo que se guarda.
 */
export const timeRangeSchema = z
  .object({ start: wallTime, end: wallTime })
  .transform((r) => ({ start: r.start, end: r.end === "00:00" ? "24:00" : r.end }))
  .refine((r) => wallTimeToMinutes(r.end) > wallTimeToMinutes(r.start), {
    message: "El fin tiene que ser posterior al inicio",
  });

export const weeklyHoursSchema = z
  .object(
    Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, z.array(timeRangeSchema).optional()])) as Record<
      WeekdayKey,
      z.ZodOptional<z.ZodArray<typeof timeRangeSchema>>
    >,
  )
  .strict();

export const dateOverrideSchema = z.object({
  date: z.string().refine(isValidDateString, "Fecha inválida, usá YYYY-MM-DD"),
  ranges: z.array(timeRangeSchema),
});

export const dateOverridesSchema = z.array(dateOverrideSchema);

export interface RangeError {
  /** Día de la semana (0-6) para reglas semanales, o la fecha para excepciones. */
  day: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; errors: RangeError[] };

/**
 * Superposición dentro de una lista de rangos del mismo día. Dos rangos que
 * se tocan (9–12 y 12–14) no se superponen.
 */
export function findOverlap(ranges: TimeRange[]): [TimeRange, TimeRange] | null {
  const sorted = [...ranges].sort((a, b) => wallTimeToMinutes(a.start) - wallTimeToMinutes(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (wallTimeToMinutes(sorted[i].start) < wallTimeToMinutes(sorted[i - 1].end)) {
      return [sorted[i - 1], sorted[i]];
    }
  }
  return null;
}

function rangesErrors(day: string, ranges: unknown): RangeError[] {
  const parsed = z.array(timeRangeSchema).safeParse(ranges);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return [{ day, message: first?.message ?? "Rango inválido" }];
  }
  const overlap = findOverlap(parsed.data);
  if (overlap) {
    return [
      {
        day,
        message: `Los rangos ${overlap[0].start}–${overlap[0].end} y ${overlap[1].start}–${overlap[1].end} se superponen`,
      },
    ];
  }
  return [];
}

/** Valida las reglas semanales completas. Marca cada día con problema. */
export function validateWeeklyHours(rules: unknown): ValidationResult {
  if (typeof rules !== "object" || rules === null || Array.isArray(rules)) {
    return { ok: false, errors: [{ day: "*", message: "Formato inválido" }] };
  }
  const errors: RangeError[] = [];
  for (const [key, ranges] of Object.entries(rules as Record<string, unknown>)) {
    if (!WEEKDAY_KEYS.includes(key as WeekdayKey)) {
      errors.push({ day: key, message: "Día inválido (0 = domingo … 6 = sábado)" });
      continue;
    }
    if (ranges === undefined) continue;
    if (!Array.isArray(ranges)) {
      errors.push({ day: key, message: "Los rangos tienen que ser una lista" });
      continue;
    }
    errors.push(...rangesErrors(key, ranges));
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Valida la lista de excepciones. Marca cada fecha con problema; rechaza fechas repetidas. */
export function validateOverrides(overrides: unknown): ValidationResult {
  if (!Array.isArray(overrides)) {
    return { ok: false, errors: [{ day: "*", message: "Formato inválido" }] };
  }
  const errors: RangeError[] = [];
  const seen = new Set<string>();
  overrides.forEach((item, i) => {
    const date = typeof item?.date === "string" ? item.date : `#${i}`;
    if (!isValidDateString(date)) {
      errors.push({ day: date, message: "Fecha inválida, usá YYYY-MM-DD" });
      return;
    }
    if (seen.has(date)) {
      errors.push({ day: date, message: "La fecha está repetida" });
      return;
    }
    seen.add(date);
    if (!Array.isArray(item.ranges)) {
      errors.push({ day: date, message: "Los rangos tienen que ser una lista" });
      return;
    }
    errors.push(...rangesErrors(date, item.ranges));
  });
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Normaliza (parsea con Zod) y devuelve las reglas listas para guardar, o null si no validan. */
export function parseWeeklyHours(rules: unknown): WeeklyHours | null {
  if (!validateWeeklyHours(rules).ok) return null;
  const parsed = weeklyHoursSchema.safeParse(rules);
  return parsed.success ? (parsed.data as WeeklyHours) : null;
}

export function parseOverrides(overrides: unknown): DateOverride[] | null {
  if (!validateOverrides(overrides).ok) return null;
  const parsed = dateOverridesSchema.safeParse(overrides);
  return parsed.success ? parsed.data : null;
}

/**
 * Suma o reemplaza excepciones: una por fecha (F12). Devuelve la lista nueva,
 * ordenada por fecha.
 */
export function upsertOverrides(current: DateOverride[], incoming: DateOverride[]): DateOverride[] {
  const byDate = new Map(current.map((o) => [o.date, o]));
  for (const o of incoming) byDate.set(o.date, o);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Quita las excepciones de fechas pasadas de más de `keepDays` días (F12: al
 * guardar se recortan; se conservan en `audit_log`, eso lo hace la acción).
 */
export function trimPastOverrides(
  overrides: DateOverride[],
  today: string,
  keepDays: number = 90,
): { kept: DateOverride[]; removed: DateOverride[] } {
  const cutoff = addDays(today, -keepDays);
  const kept: DateOverride[] = [];
  const removed: DateOverride[] = [];
  for (const o of overrides) (o.date < cutoff ? removed : kept).push(o);
  return { kept, removed };
}

/** Las excepciones desde hoy en adelante, para la lista de la pantalla. */
export function upcomingOverrides(overrides: DateOverride[], today: string): DateOverride[] {
  return overrides.filter((o) => o.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}

/** "Horario normal": lunes a viernes de 9 a 17 (F3). */
export function defaultWeeklyHours(): WeeklyHours {
  const range: TimeRange = { start: "09:00", end: "17:00" };
  return { "1": [range], "2": [range], "3": [range], "4": [range], "5": [range] };
}
