/**
 * Las cuentas del dashboard de Llamadas (F33): como le va al equipo y a cada
 * closer en las llamadas ya analizadas.
 *
 * Puro y sin dependencias de la base: la pantalla pide las filas
 * (`calls-load.ts`, con el cliente del usuario: la RLS decide que ve cada quien)
 * y de aca salen todos los numeros. Las reglas son las de siempre de los
 * dashboards:
 *
 * - **Nunca se inventa un cero.** Sin llamadas analizadas en el periodo no hay
 *   promedios: son `null` y la pantalla muestra su estado vacio.
 * - **Nada se pierde.** Una llamada sin objecion, sin resultado o sin
 *   calificacion va a "Sin dato", asi la suma de las filas es el total.
 * - Las semanas empiezan el lunes, en la zona del negocio: una llamada del
 *   domingo a las 23:30 en Costa Rica (lunes en UTC) cuenta en la semana de ese
 *   domingo, no en la siguiente.
 * - Los criterios van de 1 a 5 (como los puntua la IA); los puntajes de closer
 *   y de lead, de 0 a 100.
 */

import { weekKey } from "@/lib/scheduling/limits/counts";
import { effectiveCategory } from "@/lib/calls/categories";
import type { CallCategories } from "@/lib/calls/rubric";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export interface CallCriterion {
  code: string;
  name: string;
  /** De 1 a 5. */
  score: number;
}

/** Lo que el dashboard necesita de una llamada analizada. */
export interface DashboardCall {
  id: string;
  recordedAt: string;
  closerId: string | null;
  callType: string | null;
  closerScore: number | null;
  leadScore: number | null;
  qualification: string | null;
  outcome: string | null;
  /** La clave cruda de `calls.main_objection`; el mapeo a la categoria vigente se hace al mostrar. */
  mainObjection: string | null;
  hasOpenAlerts: boolean;
  criteria: CallCriterion[];
}

/** Los criterios del `analysis.rubrica` guardado, tolerante a lo que falte. */
export function parseCriteria(rubrica: unknown): CallCriterion[] {
  if (!Array.isArray(rubrica)) return [];
  const out: CallCriterion[] = [];
  for (const r of rubrica) {
    if (!isObj(r)) continue;
    const code = typeof r.codigo === "string" ? r.codigo : "";
    const score = Number(r.puntaje);
    if (!code || !Number.isFinite(score) || score < 1 || score > 5) continue;
    out.push({ code, name: typeof r.nombre === "string" && r.nombre ? r.nombre : code, score });
  }
  return out;
}

const avg = (values: number[]): number | null => (values.length ? Math.round((values.reduce((a, v) => a + v, 0) / values.length) * 10) / 10 : null);
const nums = (values: Array<number | null>): number[] => values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

// ── Arriba: el resumen ───────────────────────────────────────────────────

export interface Headline {
  analyzed: number;
  avgCloserScore: number | null;
  avgLeadScore: number | null;
  /** % de las llamadas con calificacion que quedaron "calificado". null si ninguna la tiene. */
  qualifiedPct: number | null;
  openAlerts: number;
}

export function computeHeadline(calls: DashboardCall[]): Headline {
  const qualified = calls.filter((c) => c.qualification);
  return {
    analyzed: calls.length,
    avgCloserScore: avg(nums(calls.map((c) => c.closerScore))),
    avgLeadScore: avg(nums(calls.map((c) => c.leadScore))),
    qualifiedPct: qualified.length ? Math.round((qualified.filter((c) => c.qualification === "calificado").length / qualified.length) * 100) : null,
    openAlerts: calls.filter((c) => c.hasOpenAlerts).length,
  };
}

// ── Promedio por criterio y foco de cada closer ──────────────────────────

export interface CriterionAverage {
  code: string;
  name: string;
  /** Promedio de 1 a 5. */
  avg: number;
  /** En cuantas llamadas aparecio el criterio. */
  calls: number;
}

export function criteriaAverages(calls: DashboardCall[]): CriterionAverage[] {
  const acc = new Map<string, { name: string; scores: number[] }>();
  for (const call of calls) {
    for (const c of call.criteria) {
      const e = acc.get(c.code) ?? { name: c.name, scores: [] };
      e.scores.push(c.score);
      acc.set(c.code, e);
    }
  }
  return [...acc.entries()]
    .map(([code, e]) => ({ code, name: e.name, avg: avg(e.scores)!, calls: e.scores.length }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Con menos llamadas que esto no se dice cual es el foco de un closer: seria opinar con un solo dato. */
export const MIN_CALLS_FOR_FOCUS = 3;

/** Los criterios mas bajos (con al menos `minCalls` llamadas), desempatando por codigo. */
export function lowestCriteria(criteria: CriterionAverage[], n = 1, minCalls = MIN_CALLS_FOR_FOCUS): CriterionAverage[] {
  return criteria
    .filter((c) => c.calls >= minCalls)
    .sort((a, b) => a.avg - b.avg || a.code.localeCompare(b.code))
    .slice(0, n);
}

export interface CloserSummary {
  closerId: string;
  name: string;
  calls: number;
  avgCloserScore: number | null;
  avgLeadScore: number | null;
  criteria: CriterionAverage[];
  /** El criterio mas bajo, o null si ninguno tiene al menos 3 llamadas ("pocas llamadas para decir"). */
  focus: CriterionAverage | null;
}

export const UNKNOWN_CLOSER_ID = "sin_closer";

export function closerSummaries(calls: DashboardCall[], names: Map<string, string>): CloserSummary[] {
  const byCloser = new Map<string, DashboardCall[]>();
  for (const call of calls) {
    const key = call.closerId ?? UNKNOWN_CLOSER_ID;
    byCloser.set(key, [...(byCloser.get(key) ?? []), call]);
  }
  return [...byCloser.entries()]
    .map(([closerId, list]) => {
      const criteria = criteriaAverages(list);
      return {
        closerId,
        name: closerId === UNKNOWN_CLOSER_ID ? "Sin closer" : (names.get(closerId) ?? "Sin nombre"),
        calls: list.length,
        avgCloserScore: avg(nums(list.map((c) => c.closerScore))),
        avgLeadScore: avg(nums(list.map((c) => c.leadScore))),
        criteria,
        focus: lowestCriteria(criteria, 1)[0] ?? null,
      };
    })
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name, "es"));
}

// ── Objeciones ───────────────────────────────────────────────────────────

export interface ObjectionRow {
  key: string;
  label: string;
  calls: number;
  /** De esas llamadas, cuantas terminaron en venta. */
  sales: number;
}

export const NO_DATA_KEY = "sin_dato";
export const NO_DATA_LABEL = "Sin dato";

/** El top de objeciones. La categoria se muestra segun las decisiones tomadas (unir, descartar), sin tocar las llamadas. */
export function topObjections(calls: DashboardCall[], categories?: CallCategories | null): ObjectionRow[] {
  const acc = new Map<string, ObjectionRow>();
  for (const call of calls) {
    if (!call.mainObjection) continue;
    const e = categories ? effectiveCategory("objeciones", call.mainObjection, categories) : { key: call.mainObjection, label: call.mainObjection.replace(/_/g, " ") };
    const row = acc.get(e.key) ?? { key: e.key, label: e.label.charAt(0).toUpperCase() + e.label.slice(1), calls: 0, sales: 0 };
    row.calls += 1;
    if (call.outcome === "venta") row.sales += 1;
    acc.set(e.key, row);
  }
  return [...acc.values()].sort((a, b) => b.calls - a.calls || a.label.localeCompare(b.label, "es"));
}

// ── Calificacion × resultado ─────────────────────────────────────────────

export const QUALIFICATION_ORDER = ["calificado", "con_reservas", "no_calificado"] as const;

export interface QualificationMatrix {
  /** Los resultados que aparecen, de mas a menos frecuente. */
  outcomes: string[];
  rows: Array<{ qualification: string; total: number; cells: Record<string, number> }>;
}

export function qualificationMatrix(calls: DashboardCall[]): QualificationMatrix {
  const outcomeCount = new Map<string, number>();
  for (const c of calls) outcomeCount.set(c.outcome ?? NO_DATA_KEY, (outcomeCount.get(c.outcome ?? NO_DATA_KEY) ?? 0) + 1);
  const outcomes = [...outcomeCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);

  const keys = [...QUALIFICATION_ORDER, NO_DATA_KEY];
  const rows = keys.map((qualification) => {
    const list = calls.filter((c) => (c.qualification ?? NO_DATA_KEY) === qualification);
    const cells: Record<string, number> = {};
    for (const c of list) cells[c.outcome ?? NO_DATA_KEY] = (cells[c.outcome ?? NO_DATA_KEY] ?? 0) + 1;
    return { qualification, total: list.length, cells };
  });
  return { outcomes, rows: rows.filter((r) => r.total > 0) };
}

// ── Evolucion por semana ─────────────────────────────────────────────────

export interface WeekPoint {
  /** El lunes de la semana (AAAA-MM-DD), en la zona del negocio. */
  weekStart: string;
  avgCloserScore: number | null;
  calls: number;
}

export function weeklyEvolution(calls: DashboardCall[], timeZone: string): WeekPoint[] {
  const byWeek = new Map<string, DashboardCall[]>();
  for (const c of calls) {
    const key = weekKey(c.recordedAt, timeZone);
    byWeek.set(key, [...(byWeek.get(key) ?? []), c]);
  }
  return [...byWeek.entries()]
    .map(([weekStart, list]) => ({ weekStart, avgCloserScore: avg(nums(list.map((c) => c.closerScore))), calls: list.length }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}
