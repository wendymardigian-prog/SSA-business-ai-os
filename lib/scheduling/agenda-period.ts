import { civilDate, startOfDay, endOfDay } from "@/lib/dates";

/**
 * Los atajos de período de Agenda (F33, Agenda v2).
 *
 * A diferencia de `lib/dashboards/period.ts` (que nunca mira para adelante:
 * no hay metricas del futuro), acá el futuro es el caso normal: una agenda se
 * ve antes de que pase. El default muestra lo que acaba de pasar junto con lo
 * que viene, para que una cancelación de ayer no desaparezca de la vista sin
 * cambiar de filtro.
 */
export const AGENDA_PERIODS = [
  "7-30",
  "hoy",
  "manana",
  "esta-semana",
  "proxima-semana",
  "este-mes",
  "proximo-mes",
  "proximos-30",
  "ultimos-30",
  "todo",
] as const;

export type AgendaPeriod = (typeof AGENDA_PERIODS)[number];

export const DEFAULT_AGENDA_PERIOD: AgendaPeriod = "7-30";

export const AGENDA_PERIOD_LABELS: Record<AgendaPeriod, string> = {
  "7-30": "Últimos 7 + próximos 30 días",
  hoy: "Hoy",
  manana: "Mañana",
  "esta-semana": "Esta semana",
  "proxima-semana": "Próxima semana",
  "este-mes": "Este mes",
  "proximo-mes": "Próximo mes",
  "proximos-30": "Próximos 30 días",
  "ultimos-30": "Últimos 30 días",
  todo: "Todo",
};

export interface ResolvedAgendaPeriod {
  from: string | null;
  to: string | null;
}

type CivilDate = { year: number; month: number; day: number };

const iso = (d: Date) => d.toISOString();

/** Días desde una fecha civil, sobre el calendario (sobrevive al cambio de hora). */
function addDays(c: CivilDate, delta: number): CivilDate {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Día de la semana civil (0=domingo … 6=sábado) de una fecha civil. */
function weekday(c: CivilDate): number {
  return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
}

function mondayOf(c: CivilDate): CivilDate {
  const back = weekday(c) === 0 ? 6 : weekday(c) - 1;
  return addDays(c, -back);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isAgendaPeriod(value: string): value is AgendaPeriod {
  return (AGENDA_PERIODS as readonly string[]).includes(value);
}

/** Resuelve un atajo a un rango de instantes UTC, en la zona de la pantalla. */
export function resolveAgendaPeriod(period: AgendaPeriod, now: Date, timeZone: string): ResolvedAgendaPeriod {
  const today = civilDate(now, timeZone);
  const start = (c: CivilDate) => iso(startOfDay(c.year, c.month, c.day, timeZone));
  const end = (c: CivilDate) => iso(endOfDay(c.year, c.month, c.day, timeZone));

  switch (period) {
    case "7-30":
      return { from: start(addDays(today, -7)), to: end(addDays(today, 30)) };
    case "hoy":
      return { from: start(today), to: end(today) };
    case "manana": {
      const t = addDays(today, 1);
      return { from: start(t), to: end(t) };
    }
    case "esta-semana": {
      const monday = mondayOf(today);
      return { from: start(monday), to: end(addDays(monday, 6)) };
    }
    case "proxima-semana": {
      const nextMonday = addDays(mondayOf(today), 7);
      return { from: start(nextMonday), to: end(addDays(nextMonday, 6)) };
    }
    case "este-mes":
      return {
        from: start({ year: today.year, month: today.month, day: 1 }),
        to: end({ year: today.year, month: today.month, day: lastDayOfMonth(today.year, today.month) }),
      };
    case "proximo-mes": {
      const y = today.month === 12 ? today.year + 1 : today.year;
      const m = today.month === 12 ? 1 : today.month + 1;
      return { from: start({ year: y, month: m, day: 1 }), to: end({ year: y, month: m, day: lastDayOfMonth(y, m) }) };
    }
    case "proximos-30":
      return { from: start(today), to: end(addDays(today, 30)) };
    case "ultimos-30":
      return { from: start(addDays(today, -30)), to: end(today) };
    case "todo":
      return { from: null, to: null };
  }
}
