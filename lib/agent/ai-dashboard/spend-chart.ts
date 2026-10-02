import type { ChartSeries } from "@/components/dashboards/charts";
import type { TrendPoint } from "@/components/dashboards/chat/trend-chart";
import { fromKey, formatCivilShort } from "@/lib/dashboards/chat/date-range";
import { seriesColor, seriesKeyFor, seriesLabel, SOURCE_ORDER } from "./source-palette";

const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Una fila de `ai_spend_by_day` (00112), ya con los numeros parseados. */
export interface SpendByDayRow {
  day: string;
  source: string | null;
  runs: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  missing_pricing: number;
}

export interface SpendSeriesResult {
  points: TrendPoint[];
  series: ChartSeries[];
  /** Gasto total del dia, en el mismo orden que `points` (para "hoy"/"ayer", A3). */
  totalsByDay: Map<string, number>;
}

function longLabel(day: string): string {
  const c = fromKey(day);
  if (!c) return day;
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day));
  return `${DOW[d.getUTCDay()]} ${formatCivilShort(c)}`;
}

/**
 * Arma los puntos y las series del grafico de barras (A4), en USD.
 *
 * Los segmentos salen de los DATOS del rango, nunca de la lista de valores
 * del CHECK (R5.3): un `source` sin ninguna corrida en todo el periodo no
 * aparece, ni siquiera en la leyenda. Una fila con `source: null` (00112: el
 * rango entero esta vacio) no arma ninguna serie; el llamador decide mostrar
 * el estado vacio en vez del grafico.
 */
export function buildSpendSeries(rows: SpendByDayRow[]): SpendSeriesResult {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const points: TrendPoint[] = days.map((day) => ({ bucket: formatCivilShort(fromKey(day) ?? { year: 0, month: 1, day: 1 }), label: longLabel(day) }));
  const totalsByDay = new Map<string, number>(days.map((d) => [d, 0]));

  // dia -> clave de serie -> costo sumado (varios origenes de sistema pueden caer en "otros" el mismo dia).
  const bySeries = new Map<string, Map<string, number>>();
  const present = new Set<string>();

  for (const row of rows) {
    if (row.source === null) continue; // periodo entero sin corridas: sin series.
    const key = seriesKeyFor(row.source);
    if (row.runs > 0) present.add(key);
    const byDay = bySeries.get(key) ?? new Map<string, number>();
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.cost_usd);
    bySeries.set(key, byDay);
    totalsByDay.set(row.day, (totalsByDay.get(row.day) ?? 0) + row.cost_usd);
  }

  const series: ChartSeries[] = SOURCE_ORDER.filter((key) => present.has(key)).map((key) => {
    const byDay = bySeries.get(key) ?? new Map<string, number>();
    return {
      key,
      label: seriesLabel(key),
      color: seriesColor(key),
      points: days.map((day, i) => ({ bucket: points[i].bucket, value: byDay.get(day) ?? 0 })),
    };
  });

  return { points, series, totalsByDay };
}
