"use client";

import { useMemo, useState } from "react";
import { Clock, Users } from "lucide-react";
import type { BreakdownRow } from "@/lib/meta/live";
import {
  audienceStack,
  ctrByAge,
  genderTotals,
  hourlySeries,
  parseAudience,
} from "@/lib/dashboards/ads-view";
import { AudienceStackChart, CtrByAgeChart, GenderDonut, HourlyChart } from "./charts-lazy";
import { LiveError, type Live } from "./insight-cards";
import { PillToggle } from "./toggles";

const CARD = "space-y-3 rounded-xl border border-border bg-card p-3";
const LABEL = "text-xs font-medium uppercase tracking-wider text-muted-foreground";

/** Edad y genero: barras apiladas, CTR por franja y la dona del genero. */
export function AudienceCard({ result }: { result: Live<BreakdownRow[]> }) {
  const [metric, setMetric] = useState<"reach" | "leads">("reach");
  const data = useMemo(() => parseAudience(result?.ok ? result.data : []), [result]);
  const stack = useMemo(() => audienceStack(data, metric), [data, metric]);
  const totals = useMemo(() => genderTotals(data), [data]);
  const ctr = useMemo(() => ctrByAge(data), [data]);

  return (
    <section className={CARD} aria-label="Audiencia — Edad y género">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Users className="h-4 w-4 text-primary" aria-hidden /> Audiencia — Edad &amp; Género
      </h3>
      {data.length === 0 ? (
        <LiveError result={result} className="flex h-40 items-center justify-center text-xs text-muted-foreground" />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <div className="space-y-6 md:col-span-3">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className={LABEL}>{metric === "reach" ? "Alcance" : "Leads"} por edad y género</p>
                <PillToggle
                  label="Métrica por edad y género"
                  value={metric}
                  onChange={setMetric}
                  options={[
                    { value: "reach", label: "Alcance" },
                    { value: "leads", label: "Leads" },
                  ]}
                />
              </div>
              {stack.rows.length === 0 ? (
                <p className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                  {metric === "leads" ? "Sin leads en el período" : "Sin datos para el período seleccionado"}
                </p>
              ) : (
                <AudienceStackChart rows={stack.rows} genders={stack.genders} metric={metric} />
              )}
            </div>
            <div>
              <p className={`${LABEL} mb-3`}>CTR por franja de edad</p>
              {ctr.rows.length > 0 ? (
                <CtrByAgeChart rows={ctr.rows} genders={ctr.genders} />
              ) : (
                <p className="text-xs text-muted-foreground">Sin datos de CTR disponibles</p>
              )}
            </div>
          </div>

          <div className="flex flex-col md:col-span-1">
            <p className={`${LABEL} mb-3`}>Distribución por género</p>
            <div className="flex flex-1 flex-col items-center justify-center gap-4">
              {totals.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin datos de alcance</p>
              ) : (
                <>
                  <GenderDonut totals={totals} />
                  <div className="w-full space-y-2">
                    {totals.map((g) => (
                      <div key={g.gender} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} aria-hidden />
                        <span className="text-xs text-muted-foreground">{g.name}</span>
                        <span className="ml-auto text-xs font-medium text-foreground">{g.share}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** El rendimiento por hora del dia (en los detalles). */
export function HourlyCard({ result, currency }: { result: Live<BreakdownRow[]>; currency: string | null }) {
  const [metric, setMetric] = useState<"spend" | "ctr" | "clicks">("spend");
  const series = useMemo(() => hourlySeries(result?.ok ? result.data : []), [result]);
  const hasData = series.some((h) => (h.spend ?? 0) > 0 || (h.clicks ?? 0) > 0);

  return (
    <section className={CARD} aria-label="Rendimiento por hora del día">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Clock className="h-4 w-4 text-primary" aria-hidden /> Rendimiento por hora del día
        </h3>
        <PillToggle
          label="Métrica por hora"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "spend", label: "Gasto" },
            { value: "ctr", label: "CTR" },
            { value: "clicks", label: "Clics" },
          ]}
        />
      </div>
      {!hasData ? (
        <LiveError result={result} className="flex h-40 items-center justify-center text-xs text-muted-foreground" />
      ) : (
        <HourlyChart data={series} metric={metric} currency={currency} />
      )}
    </section>
  );
}
