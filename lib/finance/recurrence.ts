/**
 * Motor de recurrencia de los gastos (GF15). Puro: trabaja SOLO con fechas civiles `AAAA-MM-DD` y toda la
 * aritmetica es en UTC sobre el calendario. No conoce zonas horarias ni la hora del proceso: quien llama
 * resuelve "hoy" con `localToday(now, workspace.timezone)` y se lo pasa.
 *
 * Portado de `getPendingPaymentDates` de prevxcrm, con sus bugs corregidos (plano 00-comun §3.4):
 *  - nada de `new Date(año, mes, día)` ni `parseISO` (dependian de la zona del servidor);
 *  - "crear N dias antes" cruza de mes y de año en TODAS las frecuencias;
 *  - la fecha de fin se compara contra la fecha de PAGO, no contra la de creacion;
 *  - la anual existe y recorta igual que la mensual (29/02 → 28/02 en años no bisiestos).
 *
 * Reglas:
 *  - mensual    `min(monthlyDay, ultimo dia del mes)`;
 *  - quincenal  el 15 y el ultimo dia de cada mes;
 *  - anual      `yearlyMonth`/`yearlyDay` con el mismo recorte;
 *  - semanal    la primera es el primer `weeklyDay` >= `startDate`; de ahi cada `weeklyInterval` semanas
 *               contadas desde ESA primera, aunque `from` sea posterior (la cadencia no se corre).
 */
import { z } from "zod";
import { addDays, compareCivil, daysBetween, lastDayOfMonth, weekdayOf, type CivilDate } from "./dates";
import type { RuleResult } from "./expense-rules";

export type { CivilDate };
export { addDays as addDaysCivil, compareCivil, lastDayOfMonth };

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RecurrenceRule =
  | { frequency: "weekly"; weeklyDay: Weekday; weeklyInterval: number } // 0 = domingo
  | { frequency: "biweekly" } // 15 y ultimo dia
  | { frequency: "monthly"; monthlyDay: number } // 1..31
  | { frequency: "yearly"; yearlyMonth: number; yearlyDay: number }; // 1..12, 1..31

export type RecurrenceFrequency = RecurrenceRule["frequency"];

export const RECURRENCE_FREQUENCIES = ["weekly", "biweekly", "monthly", "yearly"] as const satisfies readonly RecurrenceFrequency[];

/** Lo que el motor necesita saber de una plantilla. */
export interface RecurrenceTemplate {
  rule: RecurrenceRule;
  startDate: CivilDate;
  endDate: CivilDate | null;
}

/** Hasta donde mira `nextOccurrence`: mas que el salto maximo (semanal cada 52 semanas = 364 dias). */
const NEXT_SEARCH_DAYS = 800;

// ── Fechas civiles ─────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");

function civil(year: number, month: number, day: number): CivilDate {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

function parts(date: CivilDate): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/**
 * `AAAA-MM-DD` que existe en el calendario. Mas estricta que `isDateOnly`: `Date.parse('2026-02-30')` no falla,
 * rueda al 1 de marzo, y una fecha asi se colaria como valida.
 */
export function isValidCivil(value: unknown): value is CivilDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = parts(value);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= lastDayOfMonth(y, m);
}

const maxCivil = (a: CivilDate, b: CivilDate) => (compareCivil(a, b) >= 0 ? a : b);
const minCivil = (a: CivilDate, b: CivilDate) => (compareCivil(a, b) <= 0 ? a : b);

// ── Generacion de fechas de pago de una regla ──────────────────────────

/** Los (año, mes) de `lo` a `hi`, ambos inclusive. */
function monthsBetween(lo: CivilDate, hi: CivilDate): Array<[number, number]> {
  const [ly, lm] = parts(lo);
  const [hy, hm] = parts(hi);
  const out: Array<[number, number]> = [];
  let y = ly;
  let m = lm;
  while (y < hy || (y === hy && m <= hm)) {
    out.push([y, m]);
    if (m === 12) {
      y += 1;
      m = 1;
    } else {
      m += 1;
    }
  }
  return out;
}

/** Fechas de pago de la regla dentro de [lo, hi]. Asume `lo >= startDate`. */
function occurrencesIn(rule: RecurrenceRule, startDate: CivilDate, lo: CivilDate, hi: CivilDate): CivilDate[] {
  if (compareCivil(lo, hi) > 0) return [];
  const out: CivilDate[] = [];
  const inRange = (d: CivilDate) => compareCivil(d, lo) >= 0 && compareCivil(d, hi) <= 0;

  switch (rule.frequency) {
    case "monthly": {
      for (const [y, m] of monthsBetween(lo, hi)) {
        const d = civil(y, m, Math.min(rule.monthlyDay, lastDayOfMonth(y, m)));
        if (inRange(d)) out.push(d);
      }
      break;
    }
    case "biweekly": {
      for (const [y, m] of monthsBetween(lo, hi)) {
        for (const d of [civil(y, m, 15), civil(y, m, lastDayOfMonth(y, m))]) if (inRange(d)) out.push(d);
      }
      break;
    }
    case "yearly": {
      const [ly] = parts(lo);
      const [hy] = parts(hi);
      for (let y = ly; y <= hy; y++) {
        const d = civil(y, rule.yearlyMonth, Math.min(rule.yearlyDay, lastDayOfMonth(y, rule.yearlyMonth)));
        if (inRange(d)) out.push(d);
      }
      break;
    }
    case "weekly": {
      const interval = Math.max(1, Math.trunc(rule.weeklyInterval) || 1);
      const step = 7 * interval;
      // La primera ocurrencia: el primer `weeklyDay` >= startDate. Es el ancla de toda la cadencia.
      const first = addDays(startDate, (rule.weeklyDay - weekdayOf(startDate) + 7) % 7);
      if (compareCivil(first, hi) > 0) break;
      const skipped = compareCivil(lo, first) > 0 ? Math.ceil(daysBetween(first, lo) / step) : 0;
      for (let d = addDays(first, skipped * step); compareCivil(d, hi) <= 0; d = addDays(d, step)) out.push(d);
      break;
    }
  }
  return [...new Set(out)].sort(compareCivil);
}

// ── API publica ────────────────────────────────────────────────────────

/**
 * Las fechas de PAGO de la plantilla que interesan. Devuelve toda fecha `d` de la regla tal que
 * `startDate <= d`, `endDate == null || d <= endDate`, `d >= from` y `d - leadDays <= to`.
 * Ordenadas y sin repetir.
 *
 * @param from     primera fecha de pago que interesa
 * @param to       "hoy": la ultima fecha de CREACION que interesa
 * @param leadDays crear N dias antes (0..60); extiende el rango hacia adelante en TODAS las frecuencias
 */
export function getPendingPaymentDates(template: RecurrenceTemplate, from: CivilDate, to: CivilDate, leadDays: number): CivilDate[] {
  const lead = Math.max(0, Math.trunc(Number(leadDays)) || 0);
  const lo = maxCivil(from, template.startDate);
  const reach = addDays(to, lead);
  const hi = template.endDate ? minCivil(reach, template.endDate) : reach;
  return occurrencesIn(template.rule, template.startDate, lo, hi);
}

/** La primera fecha de pago >= `from` (inclusive), o null si la plantilla ya terminó. */
export function firstOccurrenceOnOrAfter(template: RecurrenceTemplate, from: CivilDate): CivilDate | null {
  const lo = maxCivil(from, template.startDate);
  const reach = addDays(lo, NEXT_SEARCH_DAYS);
  const hi = template.endDate ? minCivil(reach, template.endDate) : reach;
  return occurrencesIn(template.rule, template.startDate, lo, hi)[0] ?? null;
}

/**
 * La proxima fecha de pago ESTRICTAMENTE posterior a `after` (la «próxima fecha» de la lista). Para incluir
 * hoy: `nextOccurrence(t, addDaysCivil(hoy, -1))`, o directo `firstOccurrenceOnOrAfter(t, hoy)`.
 */
export function nextOccurrence(template: RecurrenceTemplate, after: CivilDate): CivilDate | null {
  return firstOccurrenceOnOrAfter(template, addDays(after, 1));
}

// ── Validacion de la regla (Zod 4) ─────────────────────────────────────

const intIn = (min: number, max: number, label: string) =>
  z
    .number({ error: `${label}: poné un número` })
    .int(`${label} tiene que ser un número entero`)
    .min(min, `${label} va de ${min} a ${max}`)
    .max(max, `${label} va de ${min} a ${max}`);

export const recurrenceRuleSchema = z.discriminatedUnion(
  "frequency",
  [
    z.object({
      frequency: z.literal("weekly"),
      weeklyDay: intIn(0, 6, "El día de la semana"),
      weeklyInterval: intIn(1, 52, "El intervalo semanal"),
    }),
    z.object({ frequency: z.literal("biweekly") }),
    z.object({
      frequency: z.literal("monthly"),
      monthlyDay: intIn(1, 31, "El día del mes"),
    }),
    z
      .object({
        frequency: z.literal("yearly"),
        yearlyMonth: intIn(1, 12, "El mes"),
        yearlyDay: intIn(1, 31, "El día"),
      })
      // Valido para su mes en un año bisiesto: 29/02 sí, 31/04 no.
      .refine((v) => v.yearlyDay <= lastDayOfMonth(2024, v.yearlyMonth), { message: "Ese día no existe en el mes elegido", path: ["yearlyDay"] }),
  ],
  { error: "Elegí una frecuencia" },
);

/** Valida una regla que viene de afuera. Devuelve la regla limpia o el primer error en castellano. */
export function validateRecurrenceRule(input: unknown): RuleResult<{ rule: RecurrenceRule }> {
  const parsed = recurrenceRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "La frecuencia no es válida" };
  return { ok: true, rule: parsed.data as RecurrenceRule };
}
