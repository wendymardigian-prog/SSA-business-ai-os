import { civilDate, startOfDay, endOfDay } from "@/lib/dates";

/**
 * Los 11 atajos de período del dashboard (§6). Cortan los días en la zona del
 * workspace (F14). Semana de lunes a domingo. Sin días futuros: el tope de un
 * atajo abierto ("hoy", "este mes") es null (no hay datos en el futuro).
 */
export const PERIOD_PRESETS = [
  "hoy",
  "esta-semana",
  "semana-pasada",
  "este-mes",
  "mes-pasado",
  "7d",
  "30d",
  "60d",
  "90d",
  "este-ano",
  "historico",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  hoy: "Hoy",
  "esta-semana": "Esta semana",
  "semana-pasada": "Semana pasada",
  "este-mes": "Este mes",
  "mes-pasado": "Mes pasado",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "60d": "Últimos 60 días",
  "90d": "Últimos 90 días",
  "este-ano": "Este año",
  historico: "Histórico",
};

export interface ResolvedPeriod {
  from: string | null;
  to: string | null;
}

const iso = (d: Date) => d.toISOString();

/** Días desde una fecha civil, sobre el calendario (sobrevive al cambio de hora). */
function addDays(c: { year: number; month: number; day: number }, delta: number) {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Día de la semana civil (0=domingo … 6=sábado) de una fecha civil. */
function weekday(c: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
}

/** Resuelve un atajo a un rango de instantes UTC, en la zona dada. */
export function resolvePeriod(preset: PeriodPreset, now: Date, timeZone: string): ResolvedPeriod {
  const today = civilDate(now, timeZone);
  const start = (c: { year: number; month: number; day: number }) => iso(startOfDay(c.year, c.month, c.day, timeZone));
  const end = (c: { year: number; month: number; day: number }) => iso(endOfDay(c.year, c.month, c.day, timeZone));

  switch (preset) {
    case "hoy":
      return { from: start(today), to: null };
    case "esta-semana": {
      // Lunes de esta semana. weekday 0=domingo → retroceder 6; si no, weekday-1.
      const back = weekday(today) === 0 ? 6 : weekday(today) - 1;
      return { from: start(addDays(today, -back)), to: null };
    }
    case "semana-pasada": {
      const back = weekday(today) === 0 ? 6 : weekday(today) - 1;
      const thisMonday = addDays(today, -back);
      const lastMonday = addDays(thisMonday, -7);
      const lastSunday = addDays(thisMonday, -1);
      return { from: start(lastMonday), to: end(lastSunday) };
    }
    case "este-mes":
      return { from: start({ year: today.year, month: today.month, day: 1 }), to: null };
    case "mes-pasado": {
      const y = today.month === 1 ? today.year - 1 : today.year;
      const m = today.month === 1 ? 12 : today.month - 1;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return { from: start({ year: y, month: m, day: 1 }), to: end({ year: y, month: m, day: lastDay }) };
    }
    case "7d":
      return { from: start(addDays(today, -6)), to: null };
    case "30d":
      return { from: start(addDays(today, -29)), to: null };
    case "60d":
      return { from: start(addDays(today, -59)), to: null };
    case "90d":
      return { from: start(addDays(today, -89)), to: null };
    case "este-ano":
      return { from: start({ year: today.year, month: 1, day: 1 }), to: null };
    case "historico":
      return { from: null, to: null };
  }
}

export function isPeriodPreset(value: string): value is PeriodPreset {
  return (PERIOD_PRESETS as readonly string[]).includes(value);
}

/**
 * El período anterior de igual duración, inmediatamente antes (§11). Para un
 * rango abierto arriba (to=null), toma "ahora" como cierre para medir la duración.
 */
export function previousPeriod(range: ResolvedPeriod, now: Date): ResolvedPeriod {
  if (!range.from) return { from: null, to: null }; // histórico no compara
  const fromMs = new Date(range.from).getTime();
  const toMs = range.to ? new Date(range.to).getTime() : now.getTime();
  const duration = toMs - fromMs;
  return { from: new Date(fromMs - duration).toISOString(), to: new Date(fromMs - 1).toISOString() };
}
