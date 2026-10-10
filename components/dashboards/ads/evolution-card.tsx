"use client";

import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { dailySeries, type AdsRow } from "@/lib/dashboards/ads";
import { DailyEvolutionChart } from "./charts-lazy";
import { LEFT_OPTIONS, METRIC_LABELS, RIGHT_OPTIONS, type ChartMetric } from "./formatters";

/**
 * La evolucion diaria: una metrica en barras (eje izquierdo) y otra en linea
 * (eje derecho), cada una con su selector y la muestra de su color. Un dia
 * sin dato queda como hueco.
 */
export function EvolutionCard({ rows, currency }: { rows: AdsRow[]; currency: string | null }) {
  const [leftMetric, setLeftMetric] = useState<ChartMetric>("spend");
  const [rightMetric, setRightMetric] = useState<ChartMetric>("ctr");

  const data = useMemo(() => {
    const left = new Map(dailySeries(rows, leftMetric).map((p) => [p.bucket, p.value]));
    const right = new Map(dailySeries(rows, rightMetric).map((p) => [p.bucket, p.value]));
    return [...new Set([...left.keys(), ...right.keys()])]
      .sort()
      .map((bucket) => ({ date: bucket.slice(5), left: left.get(bucket) ?? null, right: right.get(bucket) ?? null }));
  }, [rows, leftMetric, rightMetric]);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3" aria-label="Evolución diaria">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-primary" aria-hidden /> Evolución diaria
        </h3>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-primary" aria-hidden />
            <span className="text-muted-foreground">Eje izq:</span>
            <select
              value={leftMetric}
              onChange={(e) => setLeftMetric(e.target.value as ChartMetric)}
              className="cursor-pointer rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
            >
              {LEFT_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {METRIC_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 rounded bg-[#ec4899]" aria-hidden />
            <span className="text-muted-foreground">Eje der:</span>
            <select
              value={rightMetric}
              onChange={(e) => setRightMetric(e.target.value as ChartMetric)}
              className="cursor-pointer rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
            >
              {RIGHT_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {METRIC_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="h-72">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sin datos para el período seleccionado
          </div>
        ) : (
          <DailyEvolutionChart data={data} leftMetric={leftMetric} rightMetric={rightMetric} currency={currency} />
        )}
      </div>
    </section>
  );
}
