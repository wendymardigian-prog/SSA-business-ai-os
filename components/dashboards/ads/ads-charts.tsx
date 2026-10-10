"use client";

/**
 * Los graficos del dashboard de anuncios, con recharts.
 *
 * Esta es LA excepcion a la regla de `components/dashboards/charts.tsx`
 * (graficos en SVG a mano, sin libreria, que siguen usando Contenido y
 * Chat). El dashboard de anuncios necesita un grafico de dos ejes con
 * tooltip y leyenda, barras apiladas horizontales, lineas multiples, una
 * dona y mapas de calor por hora: rehacerlo todo a mano no queda igual y
 * son cientos de lineas de geometria para mantener.
 *
 * Para que recharts no pese en ninguna otra pantalla, NADIE importa este
 * archivo directo: se carga con `next/dynamic` desde `charts-lazy.tsx`, solo
 * al abrir un dashboard de anuncios.
 *
 * Los colores de las SERIES son fijos (los de la referencia); todo lo demas
 * (grilla, ejes, tooltip) sale de los tokens del tema, asi se lee igual en
 * claro y en oscuro.
 */

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { axisValue, tooltipValue, METRIC_LABELS, type ChartMetric } from "./formatters";

export const TICK = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

export const TOOLTIP_STYLE = {
  background: "var(--card)",
  color: "var(--card-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
} as const;

export const CURSOR = { fill: "var(--muted)", opacity: 0.4 } as const;

/** El color de la linea del eje derecho, el de la referencia. */
export const LINE_COLOR = "#ec4899";

export interface DailyPoint {
  /** "10-07": mes y dia. */
  date: string;
  left: number | null;
  right: number | null;
}

/**
 * La evolucion diaria: una metrica en barras (eje izquierdo) y otra en linea
 * (eje derecho). Un dia sin dato es un hueco, no un cero.
 */
export function DailyEvolutionChart({
  data,
  leftMetric,
  rightMetric,
  currency,
}: {
  data: DailyPoint[];
  leftMetric: ChartMetric;
  rightMetric: ChartMetric;
  currency: string | null;
}) {
  const metricOf = (key: string) => (key === "left" ? leftMetric : rightMetric);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis
          yAxisId="left"
          orientation="left"
          tick={TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => axisValue(leftMetric, v, currency)}
          width={52}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => axisValue(rightMetric, v, currency)}
          width={44}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={CURSOR}
          formatter={(value, name) => [
            typeof value === "number" ? tooltipValue(metricOf(String(name)), value, currency) : "—",
            METRIC_LABELS[metricOf(String(name))],
          ]}
        />
        <Legend
          formatter={(value) => METRIC_LABELS[metricOf(String(value))]}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        />
        <Bar yAxisId="left" dataKey="left" fill="var(--primary)" radius={[6, 6, 0, 0]} maxBarSize={40} />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="right"
          stroke={LINE_COLOR}
          strokeWidth={2}
          dot={{ r: 3, fill: LINE_COLOR }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
