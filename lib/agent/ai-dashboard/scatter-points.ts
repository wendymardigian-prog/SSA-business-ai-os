/**
 * De una fila de `ai_runs_scatter` (00112) a lo que la pestaña Puntos de A4
 * necesita decidir: el color (verde/rojo), el carril (costo o sin costo) y el
 * radio.
 */

export interface ScatterRunRow {
  id: string;
  created_at: string;
  source: string;
  status: string;
  cost_usd: number | null;
  latency_ms: number | null;
  input_tokens: number | null;
  total_tokens: number;
  conversation_id: string | null;
}

export type ScatterLane = "cost" | "none";

export interface ScatterPoint {
  id: string;
  createdAtMs: number;
  source: string;
  status: string;
  /** true = termino bien (verde); false = error o escalada (rojo). */
  ok: boolean;
  /**
   * "cost": tiene costo positivo, va en el eje logaritmico. "none": NULL (sin
   * precio cargado) o 0 (sin uso que costee algo): va en su propia franja, al
   * pie del grafico. Un costo 0 y uno NULL son cosas distintas (el tooltip lo
   * distingue), pero ninguno de los dos entra en una escala logaritmica.
   */
  lane: ScatterLane;
  costUsd: number | null;
  totalTokens: number;
}

/** Las dos corridas de las que una dispersion no puede esconder ningun punto. */
const BAD_STATUSES = new Set(["error", "escalated"]);

export function buildScatterPoints(rows: ScatterRunRow[]): ScatterPoint[] {
  return rows.map((r) => ({
    id: r.id,
    createdAtMs: new Date(r.created_at).getTime(),
    source: r.source,
    status: r.status,
    ok: !BAD_STATUSES.has(r.status),
    lane: r.cost_usd !== null && r.cost_usd > 0 ? "cost" : "none",
    costUsd: r.cost_usd,
    totalTokens: r.total_tokens,
  }));
}

const MIN_RADIUS = 3;
const MAX_RADIUS = 13;

/**
 * El radio por tokens. Por RAIZ CUADRADA: el area del punto, no el radio, es
 * lo proporcional a la cantidad (si no, el doble de tokens se ve 4 veces mas
 * grande).
 */
export function pointRadius(totalTokens: number, maxTokens: number): number {
  if (maxTokens <= 0) return MIN_RADIUS;
  const frac = Math.sqrt(Math.min(1, Math.max(0, totalTokens) / maxTokens));
  return MIN_RADIUS + frac * (MAX_RADIUS - MIN_RADIUS);
}
