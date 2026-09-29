"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Panel } from "./block";
import { TrendChart, type TrendMode, type TrendPoint } from "./trend-chart";
import type { ChartSeries } from "@/components/dashboards/charts";
import { formatCount, formatDuration } from "@/lib/dashboards/chat/comparisons";
import { TREND_TABS, trendTabLabel, type TrendBucket, type TrendTab } from "@/lib/dashboards/chat/trends";
import { AUTHOR_GROUP_COLORS, AUTHOR_GROUP_LABELS, AUTHOR_GROUPS } from "@/lib/dashboards/chat/types";
import type { TrendsBlock as TrendsData } from "@/lib/dashboards/chat/loaders";

/**
 * Tendencias, con sus cuatro pestañas (F16).
 *
 * La cuarta (primera respuesta) es una linea y no barras: es un tiempo, no una
 * cantidad, y la referencia punteada en 1 hora es lo que le da sentido al valor.
 *
 * La pestaña elegida NO va a la URL: es una forma de mirar los mismos datos, no
 * un filtro, y no cambia lo que se pide al servidor.
 */

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

function longLabel(bucket: TrendBucket, weekly: boolean): string {
  if (weekly) return `Semana ${shortDate(bucket.key)} – ${shortDate(bucket.end)}`;
  const d = new Date(`${bucket.key}T00:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${shortDate(bucket.key)}`;
}

export function TrendsBlock({ data, filteredByAuthor }: { data: TrendsData; filteredByAuthor: boolean }) {
  const [tab, setTab] = useState<TrendTab>("conversaciones");
  const { buckets, weekly, totals } = data;

  if (buckets.length === 0) {
    return (
      <Panel title="Tendencias">
        <p className="px-[18px] pb-4 text-sm text-muted-foreground">No hubo actividad en este período.</p>
      </Panel>
    );
  }

  const points: TrendPoint[] = buckets.map((b) => ({ bucket: shortDate(b.key), label: longLabel(b, weekly) }));

  let series: ChartSeries[] = [];
  let mode: TrendMode = "single";
  let reference: { value: number; label: string; color?: string } | null = null;
  let formatValue = (v: number) => formatCount(v);
  let formatAxis: ((v: number) => string) | undefined;
  let totalsLine: string[] = [];

  if (tab === "conversaciones") {
    mode = "single";
    series = [{ key: "conv", label: "Conversaciones", color: "var(--c-agent)", points: buckets.map((b, i) => ({ bucket: points[i].bucket, value: b.newConversations })) }];
    totalsLine = [`${formatCount(totals.newConversations)} en el período`];
  } else if (tab === "mensajes") {
    mode = "group";
    series = [
      { key: "recv", label: "Recibidos", color: "var(--recv)", points: buckets.map((b, i) => ({ bucket: points[i].bucket, value: b.messagesIn })) },
      { key: "sent", label: "Enviados", color: "var(--sent)", points: buckets.map((b, i) => ({ bucket: points[i].bucket, value: b.messagesOut })) },
    ];
    totalsLine = [`${formatCount(totals.messagesIn)} recibidos`, `${formatCount(totals.messagesOut)} enviados`];
  } else if (tab === "autores") {
    mode = "stack";
    series = AUTHOR_GROUPS.filter((g) => totals.sent[g] > 0).map((g) => ({
      key: g,
      label: AUTHOR_GROUP_LABELS[g],
      color: AUTHOR_GROUP_COLORS[g],
      points: buckets.map((b, i) => ({ bucket: points[i].bucket, value: b.sent[g] })),
    }));
    totalsLine = AUTHOR_GROUPS.filter((g) => totals.sent[g] > 0).map((g) => `${formatCount(totals.sent[g])} ${AUTHOR_GROUP_LABELS[g].toLowerCase()}`);
  } else {
    mode = "line";
    // En minutos: en segundos el eje de una mediana de horas es ilegible.
    series = [
      {
        key: "frt",
        label: `Mediana ${weekly ? "semanal" : "diaria"}`,
        color: "var(--c-agent)",
        points: buckets.map((b, i) => ({
          bucket: points[i].bucket,
          value: b.firstResponseMedianSeconds === null ? null : b.firstResponseMedianSeconds / 60,
        })),
      },
    ];
    reference = { value: 60, label: "1 hora", color: "var(--warn)" };
    formatValue = (v) => formatDuration(v * 60);
    formatAxis = (v) => (v >= 60 ? `${(v / 60).toFixed(v % 60 ? 1 : 0)} h` : `${Math.round(v)} min`);
    totalsLine = [`Mediana del período: ${formatDuration(totals.firstResponseMedianSeconds)}`];
  }

  return (
    <Panel
      title="Tendencias"
      actions={
        <div role="tablist" aria-label="Qué mostrar" className="inline-flex flex-wrap gap-0.5 rounded-[9px] border border-border bg-muted/60 p-[3px]">
          {TREND_TABS.map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {trendTabLabel(t, filteredByAuthor)}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex flex-wrap gap-x-[18px] gap-y-1 px-[18px] text-xs text-muted-foreground tabular-nums">
        {totalsLine.map((t) => (
          <span key={t}>{t}</span>
        ))}
        <span>{weekly ? "Por semana (el período es largo)" : "Por día"}</span>
      </div>
      <TrendChart
        points={points}
        series={series}
        mode={mode}
        reference={reference}
        formatValue={formatValue}
        formatAxis={formatAxis}
        ariaLabel={`${trendTabLabel(tab, filteredByAuthor)}, ${weekly ? "por semana" : "por día"}`}
      />
    </Panel>
  );
}
