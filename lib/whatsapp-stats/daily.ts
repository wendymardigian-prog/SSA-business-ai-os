/**
 * El grafico diario de un numero de WhatsApp (00348): por dia, los mensajes que salieron (separados por quien los
 * mando) y los que entraron. Modulo PURO: arma los 30 dias (los que no tuvieron nada valen 0) en la zona de quien mira.
 *
 * Lo que mide es lo que WhatsApp mira para bloquear un numero: lo que SALE. Un grupo cuenta como un mensaje enviado.
 */

import { civilDate, startOfDay } from "@/lib/dates";
import type { Projection, ProjectedDay } from "./projection";

export const DAILY_DAYS = 30;

/** De quien es un mensaje que salio, en el orden en que se apila y con su color fijo (no cambia con los datos). */
export const SENT_KINDS = [
  { key: "automation", label: "Automatización", hint: "Flujos y secuencias", color: "var(--wa-series-1)" },
  { key: "broadcast", label: "Broadcast", hint: "Envíos masivos de Broadcasts", color: "var(--wa-series-2)" },
  { key: "agent", label: "Agente IA directo", hint: "El agente respondió solo", color: "var(--wa-series-3)" },
  { key: "approved", label: "Agente aprobado", hint: "Borrador del agente aprobado por una persona", color: "var(--wa-series-4)" },
  { key: "human", label: "Escrito por una persona", hint: "Desde la bandeja del sistema", color: "var(--wa-series-5)" },
  { key: "external", label: "Fuera del sistema", hint: "El celular, ManyChat u otra herramienta", color: "var(--wa-series-6)" },
] as const;

export type SentKind = (typeof SENT_KINDS)[number]["key"];

export interface DailyRow {
  day: string;
  received: number;
  automation: number;
  broadcast: number;
  agent: number;
  approved: number;
  human: number;
  external: number;
}

export interface DailyPoint extends DailyRow {
  /** "8/11", para el eje. */
  label: string;
  sent: number;
  /** Un dia que todavia no llego: solo tiene lo proyectado. */
  future: boolean;
  /** Lo que se espera que salga ese dia (hoy: lo que falta). null si no hay proyeccion. */
  projected: ProjectedDay | null;
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
      broadcast: n(row.broadcast),
      agent: n(row.agent),
      approved: n(row.approved),
      human: n(row.human),
      external: n(row.external),
      sent: 0,
      future: false,
      projected: null,
    };
    point.sent = SENT_KINDS.reduce((sum, kind) => sum + point[kind.key], 0);
    out.push(point);
  }
  return out;
}

export function projectedTotal(day: ProjectedDay | null): number {
  return day ? day.broadcast + day.sequence + day.scheduled : 0;
}

/**
 * Suma la proyeccion: hoy la lleva encima de lo que ya salio, y los dias siguientes se agregan al final (solo con lo
 * proyectado). `projection` trae hoy y los dias que vienen, en la misma zona que la serie.
 */
export function withProjection(series: readonly DailyPoint[], projection: Projection | null): DailyPoint[] {
  if (!projection) return [...series];
  const out = series.map((p) => (projection[p.day] && projectedTotal(projection[p.day]) > 0 ? { ...p, projected: projection[p.day] } : p));
  const lastDay = series[series.length - 1]?.day ?? "";
  for (const key of Object.keys(projection).sort()) {
    if (key <= lastDay) continue;
    const [, m, d] = key.split("-").map(Number);
    out.push({
      day: key,
      label: `${d}/${m}`,
      received: 0,
      automation: 0,
      broadcast: 0,
      agent: 0,
      approved: 0,
      human: 0,
      external: 0,
      sent: 0,
      future: true,
      projected: projectedTotal(projection[key]) > 0 ? projection[key] : null,
    });
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
  /** Lo que se espera que salga desde hoy hasta el ultimo dia proyectado. */
  projected: number;
}

export function dailyTotals(series: readonly DailyPoint[]): DailyTotals {
  const byKind = Object.fromEntries(SENT_KINDS.map((k) => [k.key, 0])) as Record<SentKind, number>;
  let sent = 0;
  let received = 0;
  let maxSentDay: DailyPoint | null = null;
  let projected = 0;
  let pastDays = 0;
  for (const point of series) {
    projected += projectedTotal(point.projected);
    if (point.future) continue;
    pastDays++;
    sent += point.sent;
    received += point.received;
    for (const kind of SENT_KINDS) byKind[kind.key] += point[kind.key];
    if (point.sent > 0 && (!maxSentDay || point.sent > maxSentDay.sent)) maxSentDay = point;
  }
  return { sent, received, byKind, maxSentDay, avgSent: pastDays > 0 ? sent / pastDays : 0, projected };
}

/** Un techo "redondo" para el eje: 1, 2, 5, 10, 20, 50... por encima del maximo. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (value <= step * pow) return step * pow;
  return 10 * pow;
}
