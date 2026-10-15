"use client";

import { ChartLegend, DualAxisChart } from "@/components/dashboards/charts";
import { buildTrendSeries } from "@/lib/finance/dashboard-view";
import type { MonthPoint } from "@/lib/finance/metrics";

/**
 * La tendencia de 6 meses: ingresos y gastos en barras, el resultado en línea. Es un Client Component porque el
 * gráfico recibe una función (`formatBucket`) que no puede viajar desde el servidor: recibe los puntos ya
 * calculados y arma las series acá. Los meses sin datos están en 0 (un mes sin gastos es un mes sin gastos).
 */
export function TrendChart({ trend, currentMonth }: { trend: MonthPoint[]; currentMonth: string }) {
  const chart = buildTrendSeries(trend, { currentMonth });
  return (
    <div>
      <DualAxisChart bars={chart.bars} lines={chart.lines} markers={chart.markers} formatBucket={chart.formatBucket} emptyMessage="Todavía no hay movimientos en estos 6 meses." />
      <ChartLegend series={chart.legend} />
    </div>
  );
}
