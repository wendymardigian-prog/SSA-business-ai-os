"use client";

import { useMemo, useState } from "react";
import { BarChart2 } from "lucide-react";
import type { AdsRow } from "@/lib/dashboards/ads";
import { groupByObject } from "@/lib/dashboards/ads";
import {
  adComparison,
  campaignStack,
  costLines,
  hasAnyPoint,
  type CompareMetric,
} from "@/lib/dashboards/ads-view";
import { AdComparisonChart, CostLinesChart, StackedCampaignChart } from "./charts-lazy";
import { PillToggle } from "./toggles";

/**
 * La comparativa (2/3) y el costo (1/3), lado a lado.
 *
 * En el dashboard principal compara campañas (una barra por campaña, un tramo
 * por anuncio) y en el detalle de una campaña compara sus anuncios. El costo
 * de al lado es CPC o CPL diario de cada uno.
 */

const COMPARE_OPTIONS: Array<{ value: CompareMetric; label: string }> = [
  { value: "spend", label: "Gasto" },
  { value: "reach", label: "Alcance" },
  { value: "clicks", label: "Clics" },
  { value: "leads", label: "Leads" },
];

const COST_OPTIONS = [
  { value: "cpc" as const, label: "CPC" },
  { value: "cpl" as const, label: "CPL" },
];

const CARD = "rounded-xl border border-border bg-card p-3 space-y-3";

export function ComparisonCards({
  variant,
  rows,
  currency,
  adReach,
}: {
  variant: "campaigns" | "ads";
  rows: AdsRow[];
  currency: string | null;
  /** Alcance unico por anuncio (en vivo). Sin el, el alcance es la suma de los dias. */
  adReach: Record<string, number> | null;
}) {
  const [metric, setMetric] = useState<CompareMetric>("spend");
  const [cost, setCost] = useState<"cpc" | "cpl">("cpc");

  const isCampaigns = variant === "campaigns";

  const stack = useMemo(
    () => (isCampaigns ? campaignStack({ rows, metric, adReach }) : null),
    [isCampaigns, rows, metric, adReach],
  );

  const bars = useMemo(
    () => (isCampaigns ? [] : adComparison({ ads: groupByObject(rows, "ad", adReach), metric })),
    [isCampaigns, rows, metric, adReach],
  );

  const lines = useMemo(
    () => costLines({ rows, level: isCampaigns ? "campaign" : "ad", metric: cost }),
    [rows, isCampaigns, cost],
  );

  const hasStack = isCampaigns
    ? (stack?.data ?? []).some((entry) => Object.entries(entry).some(([k, v]) => k !== "campaign" && typeof v === "number" && v > 0))
    : bars.length > 0;
  const hasLines = hasAnyPoint(lines.data, lines.series);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <section className={`${CARD} lg:col-span-2`} aria-label={isCampaigns ? "Comparativa por campaña" : "Comparativa por anuncio"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart2 className="h-4 w-4 text-primary" aria-hidden />
            {isCampaigns ? "Comparativa por campaña" : "Comparativa por anuncio"}
          </h3>
          <PillToggle options={COMPARE_OPTIONS} value={metric} onChange={setMetric} label="Métrica de la comparativa" />
        </div>
        {!hasStack ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            Sin datos para el período seleccionado
          </div>
        ) : isCampaigns && stack ? (
          <StackedCampaignChart data={stack.data} series={stack.series} metric={metric} currency={currency} />
        ) : (
          <AdComparisonChart data={bars} metric={metric} currency={currency} />
        )}
      </section>

      <section className={CARD} aria-label={isCampaigns ? "Costo por campaña" : "Costo por anuncio"}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{isCampaigns ? "Costo por campaña" : "Costo por anuncio"}</h3>
          <PillToggle options={COST_OPTIONS} value={cost} onChange={setCost} label="Costo a mostrar" />
        </div>
        {!hasLines ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            {cost === "cpl" ? "Sin leads en el período" : "Sin datos para el período seleccionado"}
          </div>
        ) : (
          <CostLinesChart data={lines.data} series={lines.series} metric={cost} currency={currency} />
        )}
      </section>
    </div>
  );
}
