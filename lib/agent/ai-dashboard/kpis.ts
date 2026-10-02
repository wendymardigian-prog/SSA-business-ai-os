/**
 * Las cinco tarjetas del mini dashboard de IA (A3). Puro: recibe los totales
 * ya resueltos (de `ai_cost_report` y de la serie de `ai_spend_by_day`) y no
 * conoce Supabase.
 *
 * Reglas, todas del documento:
 *   - Sin dato del período anterior (o es cero), se dice "sin comparación":
 *     nunca un porcentaje infinito.
 *   - Entre −1 % y +1 % se dice "sin cambios" y no se dibuja flecha: una
 *     variación tan chica no es una tendencia.
 *   - La tarjeta de "hoy" compara contra AYER, nunca contra el período
 *     anterior completo: es la unica diaria, y compararla contra un mes
 *     entero no dice nada.
 */

export type ComparisonDirection = "up" | "down" | "flat";

export interface PeriodComparison {
  /** Variacion en %, redondeada. null = no hay con que comparar. */
  percent: number | null;
  direction: ComparisonDirection | null;
  /** Texto listo, sin el "vs. ..." (lo agrega quien arma la tarjeta). */
  label: string;
}

const SIN_COMPARACION = "sin comparación";
const SIN_CAMBIOS = "sin cambios";

/** Compara dos valores del mismo tipo de periodo (hoy/ayer, o periodo/periodo anterior). */
export function comparePeriod(current: number | null, previous: number | null): PeriodComparison {
  if (current === null || previous === null || previous === 0 || !Number.isFinite(previous)) {
    return { percent: null, direction: null, label: SIN_COMPARACION };
  }
  const raw = ((current - previous) / previous) * 100;
  if (raw >= -1 && raw <= 1) return { percent: Math.round(raw), direction: "flat", label: SIN_CAMBIOS };
  const percent = Math.round(raw);
  const direction: ComparisonDirection = percent > 0 ? "up" : "down";
  return { percent, direction, label: `${direction === "up" ? "▲" : "▼"} ${Math.abs(percent)} %` };
}

export interface PeriodTotals {
  runs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  embeddingTokens: number;
  missingPricing: number;
}

export interface AiKpiCard {
  value: number | null;
  comparison: PeriodComparison;
}

export interface AiKpiCards {
  today: AiKpiCard;
  period: AiKpiCard;
  tokens: AiKpiCard;
  runs: AiKpiCard;
  missingPricing: number;
}

function totalTokens(t: PeriodTotals): number {
  return t.inputTokens + t.outputTokens + t.cachedTokens + t.embeddingTokens;
}

export function buildAiKpiCards(args: {
  totals: PeriodTotals;
  /** null cuando el periodo es "historico": no hay anterior con que comparar. */
  previousTotals: PeriodTotals | null;
  /** Gasto de hoy, tomado de la serie por dia. null si hoy no cae dentro del periodo elegido. */
  todayCost: number | null;
  /** Gasto de ayer, de la misma serie. null por la misma razon. */
  yesterdayCost: number | null;
}): AiKpiCards {
  const { totals, previousTotals, todayCost, yesterdayCost } = args;
  return {
    today: { value: todayCost, comparison: comparePeriod(todayCost, yesterdayCost) },
    period: { value: totals.costUsd, comparison: comparePeriod(totals.costUsd, previousTotals?.costUsd ?? null) },
    tokens: {
      value: totalTokens(totals),
      comparison: comparePeriod(totalTokens(totals), previousTotals ? totalTokens(previousTotals) : null),
    },
    runs: { value: totals.runs, comparison: comparePeriod(totals.runs, previousTotals?.runs ?? null) },
    missingPricing: totals.missingPricing,
  };
}
