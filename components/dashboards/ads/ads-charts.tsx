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
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GENDER_COLOR, GENDER_LABEL, type Gender, type HourPoint, type Series } from "@/lib/dashboards/ads-view";
import { axisValue, compact, tooltipValue, METRIC_LABELS, type ChartMetric } from "./formatters";

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

type Row = Record<string, string | number | null>;

/**
 * Una barra horizontal por campaña, un tramo por anuncio. El tramo se
 * identifica por el id del anuncio (la clave del dato) y se NOMBRA con el
 * nombre del anuncio (`name`): la leyenda y el tooltip leen ese nombre.
 */
export function StackedCampaignChart({
  data,
  series,
  metric,
  currency,
}: {
  data: Row[];
  series: Series[];
  metric: ChartMetric;
  currency: string | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 44 + 60)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis
          type="number"
          tick={TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => axisValue(metric, v, currency)}
        />
        <YAxis type="category" dataKey="campaign" tick={TICK} axisLine={false} tickLine={false} width={120} />
        <Tooltip
          contentStyle={{ ...TOOLTIP_STYLE, borderRadius: 8 }}
          cursor={CURSOR}
          formatter={(value, name) => [typeof value === "number" ? tooltipValue(metric, value, currency) : "—", String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="campaign"
            fill={s.color}
            radius={i === series.length - 1 ? [0, 3, 3, 0] : [0, 0, 0, 0]}
            maxBarSize={32}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Una barra por anuncio (el detalle de campaña): cada barra con su color
 * estable, el mismo que tiene en el grafico de costo de al lado.
 */
export function AdComparisonChart({
  data,
  metric,
  currency,
}: {
  data: Array<{ id: string; name: string; value: number; color: string }>;
  metric: ChartMetric;
  currency: string | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis
          type="number"
          tick={TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => axisValue(metric, v, currency)}
        />
        <YAxis type="category" dataKey="name" tick={TICK} axisLine={false} tickLine={false} width={140} />
        <Tooltip
          contentStyle={{ ...TOOLTIP_STYLE, borderRadius: 8 }}
          cursor={CURSOR}
          formatter={(value) => [typeof value === "number" ? tooltipValue(metric, value, currency) : "—", METRIC_LABELS[metric]]}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
          {data.map((entry) => (
            <Cell key={entry.id} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * El costo diario (CPC o CPL) de cada objeto. `connectNulls={false}`: un dia
 * sin clics (o sin leads) corta la linea; unirla por arriba inventaria un
 * costo que no existio.
 */
export function CostLinesChart({
  data,
  series,
  metric,
  currency,
}: {
  data: Row[];
  series: Series[];
  metric: "cpc" | "cpl";
  currency: string | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={{ ...TICK, fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ ...TICK, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => axisValue(metric, v, currency)}
          width={48}
        />
        <Tooltip
          contentStyle={{ ...TOOLTIP_STYLE, borderRadius: 8, fontSize: 11 }}
          formatter={(value, name) => [typeof value === "number" ? tooltipValue(metric, value, currency) : "—", String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 2, fill: s.color }}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Alcance (o leads) por franja de edad, apilado por genero. */
export function AudienceStackChart({ rows, genders, metric }: { rows: Row[]; genders: Gender[]; metric: "reach" | "leads" }) {
  const label = metric === "reach" ? "Alcance" : "Leads";
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="age" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => compact(Math.round(v))} width={36} />
        <Tooltip
          contentStyle={{ ...TOOLTIP_STYLE, borderRadius: 8 }}
          cursor={CURSOR}
          formatter={(value, name) => [typeof value === "number" ? compact(Math.round(value)) : "—", `${GENDER_LABEL[name as Gender] ?? name} · ${label}`]}
        />
        <Legend formatter={(value) => GENDER_LABEL[value as Gender] ?? value} wrapperStyle={{ fontSize: 12 }} />
        {genders.map((g, i) => (
          <Bar
            key={g}
            dataKey={g}
            stackId="audience"
            fill={GENDER_COLOR[g]}
            opacity={0.85}
            radius={i === genders.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
            maxBarSize={48}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** El CTR de cada franja de edad, una linea por genero. */
export function CtrByAgeChart({ rows, genders }: { rows: Row[]; genders: Gender[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="age" tick={{ ...TICK, fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ ...TICK, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={32} />
        <Tooltip
          contentStyle={{ ...TOOLTIP_STYLE, borderRadius: 8 }}
          formatter={(value, name) => [typeof value === "number" ? `${value.toFixed(2)}%` : "—", GENDER_LABEL[name as Gender] ?? String(name)]}
        />
        {genders.map((g) => (
          <Line
            key={g}
            type="monotone"
            dataKey={g}
            stroke={GENDER_COLOR[g]}
            strokeWidth={2}
            dot={{ r: 3, fill: GENDER_COLOR[g] }}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** La dona del alcance por genero. */
export function GenderDonut({ totals }: { totals: Array<{ gender: Gender; name: string; value: number; color: string }> }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie data={totals} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name" strokeWidth={2} stroke="var(--background)">
          {totals.map((entry) => (
            <Cell key={entry.gender} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ ...TOOLTIP_STYLE, borderRadius: 8 }}
          formatter={(value, name) => [typeof value === "number" ? compact(Math.round(value)) : "—", String(name)]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/**
 * El rendimiento por hora del dia. La intensidad de cada barra es su valor
 * contra el maximo. Una hora sin entrega no dibuja barra (null, no cero).
 */
export function HourlyChart({ data, metric, currency }: { data: HourPoint[]; metric: "spend" | "ctr" | "clicks"; currency: string | null }) {
  const max = Math.max(...data.map((d) => d[metric] ?? 0), 0);
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ ...TICK, fontSize: 10 }} interval={2} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ ...TICK, fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => axisValue(metric, v, currency)}
          width={44}
        />
        <Tooltip
          contentStyle={{ ...TOOLTIP_STYLE, borderRadius: 8 }}
          cursor={CURSOR}
          formatter={(value) => [typeof value === "number" ? tooltipValue(metric, value, currency) : "—", METRIC_LABELS[metric]]}
          labelFormatter={(label) => `Hora: ${label}`}
        />
        <Bar dataKey={metric} radius={[2, 2, 0, 0]} maxBarSize={24}>
          {data.map((entry) => (
            <Cell key={entry.hour} fill="var(--primary)" fillOpacity={max > 0 ? 0.25 + ((entry[metric] ?? 0) / max) * 0.75 : 0.25} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
