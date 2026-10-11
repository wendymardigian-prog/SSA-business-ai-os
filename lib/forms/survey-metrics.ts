/**
 * Las cuentas del panel de una encuesta (F23). PURO. Portado de
 * `satisfaction-constants.ts` de prevxcrm (`calculateNPS`, `calculateAverage`),
 * más la distribución y la evolución.
 *
 * Todo excluye el spam (lo filtra quien arma las filas) y nunca inventa un cero:
 * sin respuestas, el NPS y el promedio son `null` y la pantalla dice "Todavía no
 * hay respuestas".
 */
import { addDays, dayInZone } from "./metrics";
import { npsCategory, type NpsCategory } from "./survey";

/** NPS = % promotores − % detractores, entero. `null` sin respuestas. */
export function calculateNPS(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

/** Promedio con dos decimales. `null` sin respuestas (no 0: un 0 sería una afirmación). */
export function calculateAverage(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const sum = scores.reduce((acc, value) => acc + (Number(value) || 0), 0);
  return Number((sum / scores.length).toFixed(2));
}

export type Scale = "nps" | "stars";

export interface SurveySummary {
  responses: number;
  nps: number | null;
  average: number | null;
  /** 0 a 100, entero. `null` sin respuestas o con estrellas. */
  promotersPct: number | null;
  passivesPct: number | null;
  detractorsPct: number | null;
}

const pct = (part: number, total: number) => Math.round((part / total) * 100);

export function summarizeSurvey(scores: number[], scale: Scale): SurveySummary {
  if (scores.length === 0) return { responses: 0, nps: null, average: null, promotersPct: null, passivesPct: null, detractorsPct: null };
  if (scale === "stars") {
    return { responses: scores.length, nps: null, average: calculateAverage(scores), promotersPct: null, passivesPct: null, detractorsPct: null };
  }
  const promoters = scores.filter((s) => s >= 9).length;
  const passives = scores.filter((s) => s >= 7 && s <= 8).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return {
    responses: scores.length,
    nps: calculateNPS(scores),
    average: calculateAverage(scores),
    promotersPct: pct(promoters, scores.length),
    passivesPct: pct(passives, scores.length),
    detractorsPct: pct(detractors, scores.length),
  };
}

export interface DistributionBar {
  value: number;
  count: number;
  /** Solo en NPS: el color por categoría. */
  category: NpsCategory | null;
}

/** Una barra por valor de la escala (0-10 o 1-5), con ceros en los valores sin respuestas. */
export function distribution(scores: number[], scale: Scale): DistributionBar[] {
  const [from, to] = scale === "nps" ? [0, 10] : [1, 5];
  const counts = new Map<number, number>();
  for (const score of scores) {
    const value = Math.round(score);
    if (value < from || value > to) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const bars: DistributionBar[] = [];
  for (let value = from; value <= to; value++) {
    bars.push({ value, count: counts.get(value) ?? 0, category: scale === "nps" ? npsCategory(value) : null });
  }
  return bars;
}

export type Granularity = "week" | "month";

export interface EvolutionRow {
  created_at: string;
  score: number;
}

export interface EvolutionPoint {
  /** `YYYY-MM-DD` del lunes (semana) o `YYYY-MM` (mes). */
  key: string;
  count: number;
  /** NPS o promedio, según la escala. `null` si el punto no tiene respuestas. */
  value: number | null;
  /** Menos de 5 respuestas: se marca "pocas respuestas". */
  few: boolean;
}

export const FEW_RESPONSES = 5;

/** Por semana hasta 90 días; por mes desde ahí. */
export function granularityFor(days: number): Granularity {
  return days <= 90 ? "week" : "month";
}

function mondayOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // lunes = 0
  return addDays(day, -weekday);
}

function bucketKey(day: string, granularity: Granularity): string {
  return granularity === "week" ? mondayOf(day) : day.slice(0, 7);
}

/**
 * La serie en el tiempo, agrupada en el día LOCAL de la zona (una respuesta a las
 * 23:30 de Costa Rica cuenta en su día, no en el siguiente de UTC). Solo trae los
 * puntos que tienen respuestas.
 */
export function evolution(rows: EvolutionRow[], granularity: Granularity, timeZone: string, scale: Scale): EvolutionPoint[] {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.score)) continue;
    const key = bucketKey(dayInZone(row.created_at, timeZone), granularity);
    const list = buckets.get(key) ?? [];
    list.push(row.score);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, scores]) => ({
      key,
      count: scores.length,
      value: scale === "nps" ? calculateNPS(scores) : calculateAverage(scores),
      few: scores.length < FEW_RESPONSES,
    }));
}
