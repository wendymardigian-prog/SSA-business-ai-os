"use client";

import Link from "next/link";
import { Notice } from "@/components/agents/fields";
import { FilterSelect, useUrlFilters } from "@/components/agents/filters";
import { formatPercent, PERIOD_OPTIONS, summarize, type DailyRow, type Period } from "@/lib/forms/metrics";
import type { MetricasDelFormulario } from "@/lib/forms/field-metrics";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function shortDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export function MetricsView({
  header,
  period,
  rows,
  fieldMetrics,
  hasAnyAnswers,
  loadError,
  activePreset,
}: {
  /** La barra del editor (la arma el servidor: plano formularios-ui, F7). */
  header: React.ReactNode;
  period: Period;
  rows: DailyRow[];
  fieldMetrics: MetricasDelFormulario;
  hasAnyAnswers: boolean;
  loadError: boolean;
  timeZone: string;
  activePreset: string;
}) {
  const url = useUrlFilters();
  const total = summarize(rows);
  const empty = total.views === 0 && total.submissions === 0 && total.starts === 0;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.views, r.submissions)));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Período"
              allLabel="últimos 30 días"
              value={activePreset === "custom" ? "" : activePreset === "30" ? "" : activePreset}
              onChange={(v) => {
                url.setParam("desde", "");
                url.setParam("hasta", "");
                url.setParam("dias", v);
              }}
              options={PERIOD_OPTIONS.filter((p) => p.value !== "30").map((p) => ({ value: p.value, label: p.label }))}
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Desde
              <input type="date" value={period.from} onChange={(e) => url.setParam("desde", e.target.value)} className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Hasta
              <input type="date" value={period.to} onChange={(e) => url.setParam("hasta", e.target.value)} className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
          </div>

          {loadError && <Notice tone="error">No pudimos cargar las métricas. Probá de nuevo.</Notice>}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Vistas" value={String(total.views)} />
            <Stat label="Inicios" value={String(total.starts)} hint={`Empezaron a completarlo: ${formatPercent(total.startRate, 0)} de las vistas`} />
            <Stat label="Envíos" value={String(total.submissions)} />
            <Stat label="Conversión" value={formatPercent(total.conversion)} hint="Envíos sobre vistas" />
          </div>
          <p className="text-xs text-muted-foreground">
            Rechazados por el campo trampa: <span className="font-medium text-foreground">{total.rejected}</span> · Marcados como spam: <span className="font-medium text-foreground">{total.spam}</span>
          </p>

          {empty ? (
            <div className="rounded-xl border border-dashed border-border py-14 text-center">
              <p className="text-sm font-medium">Sin datos en este período</p>
              <p className="mt-1 text-xs text-muted-foreground">Cuando alguien abra el formulario van a aparecer acá las vistas y los envíos.</p>
            </div>
          ) : (
            <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="por-dia">
              <h2 id="por-dia" className="text-sm font-semibold">
                Por día
              </h2>
              <div className="mt-3 flex h-40 items-end gap-0.5 overflow-x-auto" role="img" aria-label={`Vistas y envíos por día, del ${period.from} al ${period.to}`}>
                {rows.map((r) => (
                  <div key={r.day} className="flex min-w-[10px] flex-1 flex-col items-center justify-end gap-0.5" title={`${shortDay(r.day)}: ${r.views} vistas, ${r.submissions} envíos`}>
                    <div className="flex w-full items-end justify-center gap-px">
                      <div className="w-1/2 rounded-t bg-muted-foreground/30" style={{ height: `${(r.views / max) * 120}px` }} />
                      <div className="w-1/2 rounded-t bg-primary" style={{ height: `${(r.submissions / max) * 120}px` }} />
                    </div>
                    {rows.length <= 14 && <span className="text-[9px] text-muted-foreground">{shortDay(r.day)}</span>}
                  </div>
                ))}
              </div>
              <p className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted-foreground/30" /> Vistas</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> Envíos</span>
              </p>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground">Ver como tabla</summary>
                <div className="mt-2 max-h-64 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-1 pr-3 font-medium">Día</th>
                        <th scope="col" className="py-1 pr-3 font-medium">Vistas</th>
                        <th scope="col" className="py-1 pr-3 font-medium">Inicios</th>
                        <th scope="col" className="py-1 pr-3 font-medium">Envíos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.day} className="border-t border-border">
                          <td className="py-1 pr-3">{r.day}</td>
                          <td className="py-1 pr-3 tabular-nums">{r.views}</td>
                          <td className="py-1 pr-3 tabular-nums">{r.starts}</td>
                          <td className="py-1 pr-3 tabular-nums">{r.submissions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          )}

          {hasAnyAnswers && (
            <section className="space-y-4" aria-labelledby="por-campo">
              <h2 id="por-campo" className="text-sm font-semibold">
                Por campo
              </h2>
              {fieldMetrics.numericas.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {fieldMetrics.numericas.map((m) => (
                    <div key={m.id} className="rounded-xl border border-border bg-card p-4">
                      <p className="text-xs text-muted-foreground">{m.label}</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">{m.respuestas === 0 ? "—" : m.promedio.toLocaleString("es-AR")}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Promedio de {m.respuestas} {m.respuestas === 1 ? "respuesta" : "respuestas"}
                        {m.respuestas > 0 ? ` · mín. ${m.minimo} · máx. ${m.maximo}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {fieldMetrics.opciones.map((m) => (
                <div key={m.id} className="rounded-xl border border-border bg-card p-4">
                  <p className="text-sm font-medium">{m.label}</p>
                  <ul className="mt-2 space-y-1.5">
                    {m.opciones.map((o) => (
                      <li key={o.opcion} className="text-xs">
                        <div className="flex justify-between">
                          <span>{o.opcion}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {o.cantidad} · {o.porcentaje.toLocaleString("es-AR")} %
                          </span>
                        </div>
                        <div className="mt-0.5 h-1.5 rounded bg-muted">
                          <div className="h-1.5 rounded bg-primary" style={{ width: `${o.porcentaje}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {fieldMetrics.textos.map((m) => (
                <div key={m.id} className="rounded-xl border border-border bg-card p-4">
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-[11px] text-muted-foreground">{m.respuestas} respuestas · las últimas primero</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {m.ultimas.map((t, i) => (
                      <li key={`${i}-${t.slice(0, 12)}`} className="rounded-md bg-muted/50 px-2 py-1">
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
