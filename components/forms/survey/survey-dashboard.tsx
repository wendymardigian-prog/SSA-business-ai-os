"use client";

import Link from "next/link";
import { Notice } from "@/components/agents/fields";
import { FilterSelect, useUrlFilters } from "@/components/agents/filters";
import { PERIOD_OPTIONS, type Period } from "@/lib/forms/metrics";
import { NPS_CATEGORY_LABELS, type NpsCategory } from "@/lib/forms/survey";
import type { DistributionBar, EvolutionPoint, Granularity, Scale, SurveySummary } from "@/lib/forms/survey-metrics";
import { formatInZone } from "@/lib/forms/responses-query";

export interface SurveyComment {
  id: string;
  text: string;
  score: number;
  createdAt: string;
}

const CATEGORY_COLOR: Record<NpsCategory, string> = {
  promoter: "bg-emerald-500",
  passive: "bg-amber-400",
  detractor: "bg-red-500",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const pctText = (value: number | null) => (value === null ? "—" : `${value} %`);

function pointLabel(key: string, granularity: Granularity): string {
  return granularity === "month" ? `${key.slice(5, 7)}/${key.slice(2, 4)}` : `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

export function SurveyDashboard({
  header,
  topSlot,
  formId,
  period,
  scale,
  summary,
  bars,
  points,
  granularity,
  comments,
  commentLabel,
  scoreLabel,
  scopedToOwnContacts,
  truncated,
  loadError,
  activePreset,
  timeZone,
}: {
  /** La barra del editor (la arma el servidor: plano formularios-ui, F7). */
  header: React.ReactNode;
  /** Arriba del panel: la configuración de la encuesta. */
  topSlot?: React.ReactNode;
  formId: string;
  period: Period;
  scale: Scale;
  summary: SurveySummary;
  bars: DistributionBar[];
  points: EvolutionPoint[];
  granularity: Granularity;
  comments: SurveyComment[];
  commentLabel: string | null;
  scoreLabel: string | null;
  scopedToOwnContacts: boolean;
  truncated: boolean;
  loadError: boolean;
  activePreset: string;
  timeZone: string;
}) {
  const url = useUrlFilters();
  const empty = summary.responses === 0;
  const maxBar = Math.max(1, ...bars.map((b) => b.count));
  const values = points.map((p) => p.value ?? 0);
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));
  const maxAvg = scale === "stars" ? 5 : maxAbs;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {topSlot}

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
            {scopedToOwnContacts && <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">Calculado sobre las respuestas de tus contactos</span>}
          </div>

          {loadError && <Notice tone="error">No pudimos cargar las respuestas. Probá de nuevo.</Notice>}
          {truncated && <Notice tone="info">Hay más respuestas que las que se pueden calcular acá: se usaron las más recientes. Probá con un período más corto.</Notice>}

          {empty ? (
            <div className="rounded-xl border border-dashed border-border py-14 text-center">
              <p className="text-sm font-medium">Todavía no hay respuestas</p>
              <p className="mt-1 text-xs text-muted-foreground">Cuando alguien responda la encuesta, acá vas a ver el {scale === "nps" ? "NPS" : "promedio"}.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Respuestas" value={String(summary.responses)} />
                {scale === "nps" ? (
                  <>
                    <Stat label="NPS" value={summary.nps === null ? "—" : String(summary.nps)} hint="% promotores − % detractores" />
                    <Stat label="Promotores" value={pctText(summary.promotersPct)} hint="9 y 10" />
                    <Stat label="Detractores" value={pctText(summary.detractorsPct)} hint="0 a 6" />
                  </>
                ) : (
                  <Stat label="Promedio" value={summary.average === null ? "—" : summary.average.toLocaleString("es-AR")} hint={scoreLabel ?? "Estrellas de 1 a 5"} />
                )}
              </div>

              <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="distribucion">
                <h2 id="distribucion" className="text-sm font-semibold">
                  Distribución
                </h2>
                <div className="mt-3 flex h-36 items-end gap-1" role="img" aria-label={`Cantidad de respuestas por puntaje, de ${bars[0]?.value} a ${bars[bars.length - 1]?.value}`}>
                  {bars.map((bar) => (
                    <div key={bar.value} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${bar.value}: ${bar.count}`}>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{bar.count || ""}</span>
                      <div className={`w-full rounded-t ${bar.category ? CATEGORY_COLOR[bar.category] : "bg-primary"}`} style={{ height: `${(bar.count / maxBar) * 100}px` }} />
                      <span className="text-[10px] text-muted-foreground">{bar.value}</span>
                    </div>
                  ))}
                </div>
                {scale === "nps" && (
                  <p className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                    {(Object.keys(CATEGORY_COLOR) as NpsCategory[]).map((c) => (
                      <span key={c} className="inline-flex items-center gap-1">
                        <span className={`h-2 w-2 rounded-sm ${CATEGORY_COLOR[c]}`} /> {NPS_CATEGORY_LABELS[c]}
                      </span>
                    ))}
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="evolucion">
                <h2 id="evolucion" className="text-sm font-semibold">
                  Evolución {granularity === "week" ? "por semana" : "por mes"}
                </h2>
                {points.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Sin respuestas en este período.</p>
                ) : (
                  <ul className="mt-3 space-y-1.5">
                    {points.map((p) => {
                      const width = p.value === null ? 0 : Math.max(2, (Math.abs(p.value) / maxAvg) * 100);
                      return (
                        <li key={p.key} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 text-xs">
                          <span className="tabular-nums text-muted-foreground">{pointLabel(p.key, granularity)}</span>
                          <div className="h-2 rounded bg-muted">
                            <div className={`h-2 rounded ${p.value !== null && p.value < 0 ? "bg-red-500" : "bg-primary"}`} style={{ width: `${Math.min(100, width)}%` }} />
                          </div>
                          <span className="tabular-nums">
                            <span className="font-medium">{p.value === null ? "—" : scale === "nps" ? p.value : p.value.toLocaleString("es-AR")}</span>
                            <span className="ml-2 text-muted-foreground">
                              {p.count} {p.count === 1 ? "respuesta" : "respuestas"}
                              {p.few ? " · pocas respuestas" : ""}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {commentLabel && (
                <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="comentarios">
                  <h2 id="comentarios" className="text-sm font-semibold">
                    Últimos comentarios <span className="font-normal text-muted-foreground">· {commentLabel}</span>
                  </h2>
                  {comments.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">Nadie dejó comentarios en este período.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {comments.map((c) => (
                        <li key={c.id} className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                          <p className="whitespace-pre-line">{c.text}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Puntaje {c.score} · {formatInZone(c.createdAt, timeZone)} ·{" "}
                            <Link href={`/dashboard/formularios/${formId}/respuestas/${c.id}`} className="underline underline-offset-2">
                              Ver respuesta
                            </Link>
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
