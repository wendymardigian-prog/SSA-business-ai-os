"use client";

import { useMemo, useState, useTransition } from "react";
import { TrendChart } from "@/components/dashboards/chat/trend-chart";
import { formatUsd } from "@/components/agents/filters";
import { startOfDay, endOfDay } from "@/lib/dates";
import { fromKey } from "@/lib/dashboards/chat/date-range";
import { buildSpendSeries, type SpendByDayRow } from "@/lib/agent/ai-dashboard/spend-chart";
import { OTROS_KEY } from "@/lib/agent/ai-dashboard/source-palette";
import { loadAiScatterAction } from "@/lib/actions/ai-dashboard";
import type { ScatterRunRow } from "@/lib/agent/ai-dashboard/scatter-points";
import { ScatterChart } from "./scatter-chart";

type Tab = "barras" | "puntos";

/**
 * El gráfico con sus dos pestañas (A4). La pestaña elegida NO va a la URL: es
 * una forma de mirar los mismos datos, no un filtro (igual que las pestañas
 * de Tendencias del dashboard de Chat), así que cambiarla no pierde el
 * período.
 *
 * La pestaña Puntos pide `ai_runs_scatter` recien la primera vez que se abre
 * (A6), y se queda con el resultado: volver a Barras y a Puntos no vuelve a
 * pedirlo.
 */
export function SpendChartTabs({
  spendByDay,
  timeZone,
  range,
}: {
  spendByDay: SpendByDayRow[];
  timeZone: string;
  /** El rango ya resuelto del período (puede tener puntas null: "historico" o "sin techo"). */
  range: { from: string | null; to: string | null };
}) {
  const [tab, setTab] = useState<Tab>("barras");
  const [scatter, setScatter] = useState<ScatterRunRow[] | "loading" | "error" | null>(null);
  const [, startTransition] = useTransition();

  const { points, series, days } = useMemo(() => buildSpendSeries(spendByDay), [spendByDay]);

  function goToTab(next: Tab) {
    setTab(next);
    if (next === "puntos" && scatter === null) {
      setScatter("loading");
      startTransition(async () => {
        const result = await loadAiScatterAction(range);
        setScatter(result.ok ? result.data : "error");
      });
    }
  }

  // El mismo tramo de tiempo que las barras, para que las dos pestañas cuenten
  // la misma historia. Una punta abierta (historico, o "hasta ahora") cae en
  // los datos: el primer dia de la serie, o el momento actual.
  const domain = useMemo(() => {
    const firstDay = days[0] ? new Date(`${days[0]}T00:00:00Z`).getTime() : Date.now() - 86_400_000;
    return {
      fromMs: range.from ? new Date(range.from).getTime() : firstDay,
      toMs: range.to ? new Date(range.to).getTime() : Date.now(),
    };
  }, [range, days]);

  /**
   * Un dia entero del dashboard, en la zona del workspace: no UTC, para que
   * "28 de septiembre" en Corridas sea el mismo dia que en el gráfico.
   *
   * Un segmento de "Otros" no tiene un unico origen que filtrar (junta varios
   * del CHECK): esa marca queda sin link, el resto de la barra sigue siendo
   * clickeable.
   */
  function hrefFor(index: number, seriesKey?: string): string | null {
    if (seriesKey === OTROS_KEY) return null;
    const day = days[index];
    const civil = day ? fromKey(day) : null;
    if (!civil) return null;
    const params = new URLSearchParams();
    params.set("from", startOfDay(civil.year, civil.month, civil.day, timeZone).toISOString());
    params.set("to", endOfDay(civil.year, civil.month, civil.day, timeZone).toISOString());
    if (seriesKey) params.set("origen", seriesKey);
    return `/dashboard/agents/runs?${params.toString()}`;
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">Gasto de IA</h3>
        <div className="flex items-center rounded-lg border border-border p-0.5" role="group" aria-label="Vista del gráfico de gasto">
          {(["barras", "puntos"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => goToTab(v)}
              aria-pressed={tab === v}
              className={`inline-flex h-8 items-center rounded-md px-3 text-sm ${
                tab === v ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {v === "barras" ? "Barras" : "Puntos"}
            </button>
          ))}
        </div>
      </div>

      {tab === "barras" ? (
        points.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted-foreground">Todavía no hay corridas en este período.</p>
        ) : (
          <TrendChart points={points} series={series} mode="stack" ariaLabel="Gasto de IA por día, apilado por origen" formatValue={formatUsd} hrefFor={hrefFor} />
        )
      ) : scatter === "loading" || scatter === null ? (
        <div className="h-[260px] animate-pulse rounded-lg bg-muted/40" aria-hidden />
      ) : scatter === "error" ? (
        <p className="px-2 py-10 text-center text-sm text-muted-foreground">No se pudo cargar la dispersión. Probá de nuevo.</p>
      ) : (
        <ScatterChart rows={scatter} domain={domain} timeZone={timeZone} />
      )}
    </div>
  );
}
