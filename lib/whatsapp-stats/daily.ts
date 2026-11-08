/**
 * El grafico diario de un numero de WhatsApp (00348): por dia, los mensajes que salieron (separados por quien los
 * mando) y los que entraron. Modulo PURO: arma los 30 dias (los que no tuvieron nada valen 0) en la zona de quien mira.
 *
 * Lo que mide es lo que WhatsApp mira para bloquear un numero: lo que SALE. Un grupo cuenta como un mensaje enviado.
 */

import { civilDate, startOfDay } from "@/lib/dates";

export const DAILY_DAYS = 30;

/** De quien es un mensaje que salio, en el orden en que se apila y con su color fijo (no cambia con los datos). */
export const SENT_KINDS = [
  { key: "automation", label: "Automatización", hint: "Flujos, secuencias y broadcasts", color: "var(--wa-series-1)" },
  { key: "agent", label: "Agente IA directo", hint: "El agente respondió solo", color: "var(--wa-series-2)" },
  { key: "approved", label: "Agente aprobado", hint: "Borrador del agente aprobado por una persona", color: "var(--wa-series-3)" },
  { key: "human", label: "Escrito por una persona", hint: "Desde la bandeja del sistema", color: "var(--wa-series-4)" },
  { key: "external", label: "Fuera del sistema", hint: "El celular, ManyChat u otra herramienta", color: "var(--wa-series-5)" },
] as const;

export type SentKind = (typeof SENT_KINDS)[number]["key"];

export interface DailyRow {
  day: string;
  received: number;
  automation: number;
  agent: number;
  approved: number;
  human: number;
  external: number;
}

export interface DailyPoint extends DailyRow {
  /** "8/11", para el eje. */
  label: string;
  sent: number;
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Desde cuando pedirle a la base: el inicio del dia de hace 29 dias, en la zona. */
export function dailySince(now: Date, timeZone: string, days: number = DAILY_DAYS): Date {
  const today = civilDate(now, timeZone);
  const first = new Date(Date.UTC(today.year, today.month - 1, today.day - (days - 1)));
  return startOfDay(first.getUTCFullYear(), first.getUTCMonth() + 1, first.getUTCDate(), timeZone);
}

/** Los ultimos `days` dias (el mas viejo primero), con lo que vino de la base o en 0. */
export function dailySeries(rows: readonly Partial<DailyRow>[], now: Date, timeZone: string, days: number = DAILY_DAYS): DailyPoint[] {
  const byDay = new Map(rows.filter((r) => typeof r.day === "string").map((r) => [r.day as string, r]));
  const today = civilDate(now, timeZone);
  const out: DailyPoint[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day - back));
    const key = ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    const row = byDay.get(key) ?? {};
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
    const point: DailyPoint = {
      day: key,
      label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`,
      received: n(row.received),
      automation: n(row.automation),
      agent: n(row.agent),
      approved: n(row.approved),
      human: n(row.human),
      external: n(row.external),
      sent: 0,
    };
    point.sent = SENT_KINDS.reduce((sum, kind) => sum + point[kind.key], 0);
    out.push(point);
  }
  return out;
}

export interface DailyTotals {
  sent: number;
  received: number;
  byKind: Record<SentKind, number>;
  /** El dia con mas enviados (para mirar contra el tope). */
  maxSentDay: DailyPoint | null;
  /** Promedio de enviados por dia en el periodo. */
  avgSent: number;
}

export function dailyTotals(series: readonly DailyPoint[]): DailyTotals {
  const byKind = Object.fromEntries(SENT_KINDS.map((k) => [k.key, 0])) as Record<SentKind, number>;
  let sent = 0;
  let received = 0;
  let maxSentDay: DailyPoint | null = null;
  for (const point of series) {
    sent += point.sent;
    received += point.received;
    for (const kind of SENT_KINDS) byKind[kind.key] += point[kind.key];
    if (point.sent > 0 && (!maxSentDay || point.sent > maxSentDay.sent)) maxSentDay = point;
  }
  return { sent, received, byKind, maxSentDay, avgSent: series.length > 0 ? sent / series.length : 0 };
}

/** Un techo "redondo" para el eje: 1, 2, 5, 10, 20, 50... por encima del maximo. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (value <= step * pow) return step * pow;
  return 10 * pow;
}
