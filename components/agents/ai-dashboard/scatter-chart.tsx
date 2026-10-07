"use client";

import { useMemo } from "react";
import { formatUsd } from "@/components/agents/filters";
import { civilDate } from "@/lib/dates";
import { formatCivilShort } from "@/lib/dashboards/chat/date-range";
import { logDomain, logFraction, logTicks } from "@/lib/agent/ai-dashboard/log-scale";
import { buildScatterPoints, pointRadius, type ScatterRunRow } from "@/lib/agent/ai-dashboard/scatter-points";
import { RUN_STATUS_LABELS } from "@/lib/agent/run-labels";
import { seriesKeyFor, seriesLabel } from "@/lib/agent/ai-dashboard/source-palette";

/**
 * La pestaña Puntos de A4: costo contra tiempo, un punto por corrida.
 *
 * SVG a mano, sin libreria, siguiendo la convencion de TrendChart: `viewBox`
 * fijo, `<title>` como tooltip nativo, escalas separadas en su propio modulo
 * (aca logaritmica, no la lineal de lib/dashboards/chat/scale.ts: tres
 * ordenes de magnitud entre un embedding y una respuesta del agente
 * aplastarian casi todos los puntos contra el piso en una escala lineal).
 *
 * Costo NULL (sin precio) y costo 0 (sin uso que costee algo) van en su
 * propia franja, aparte del eje logaritmico: log(0) no existe, y confundir
 * "sin precio" con "cero" haria mentir al grafico.
 *
 * Nunca el color solo: ademas de verde/rojo, terminar bien es un circulo y
 * error/escalada es un rombo, y la leyenda y el tooltip dicen el estado en
 * palabras.
 */

const W = 1000;
const L = 64;
const R = 16;
const T = 14;
const PLOT_H = 170;
const LANE_GAP = 10;
const LANE_H = 30;
const DATE_H = 24;
const H = T + PLOT_H + LANE_GAP + LANE_H + DATE_H + 10;

/** Jitter deterministico (mismo id, mismo lugar siempre) para separar los puntos de la franja "sin precio". */
function jitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000) * 2 - 1; // -1..1
}

export function ScatterChart({
  rows,
  domain,
  timeZone,
}: {
  rows: ScatterRunRow[];
  /** El mismo rango de tiempo que la pestaña Barras, para que las dos cuenten la misma historia. */
  domain: { fromMs: number; toMs: number };
  timeZone: string;
}) {
  const points = useMemo(() => buildScatterPoints(rows), [rows]);
  const logDom = useMemo(() => logDomain(points.filter((p) => p.lane === "cost").map((p) => p.costUsd as number)), [points]);
  const ticks = logTicks(logDom);
  const maxTokens = Math.max(1, ...points.map((p) => p.totalTokens));

  if (points.length === 0) {
    return <p className="px-2 py-10 text-center text-sm text-muted-foreground">Todavía no hay corridas en este período.</p>;
  }

  const plotBottom = T + PLOT_H;
  const laneTop = plotBottom + LANE_GAP;
  const laneBottom = laneTop + LANE_H;
  const dateY = laneBottom + DATE_H - 6;
  const plotRight = W - 10;

  const span = Math.max(1, domain.toMs - domain.fromMs);
  const xOf = (ms: number) => L + Math.min(1, Math.max(0, (ms - domain.fromMs) / span)) * (plotRight - L);
  const yOfCost = (cost: number) => plotBottom - logFraction(cost, logDom) * PLOT_H;
  const yOfNone = (id: string) => laneTop + LANE_H / 2 + jitter(id) * (LANE_H / 2 - 6);

  const dateTicks = Array.from({ length: 5 }, (_, i) => domain.fromMs + (span * i) / 4);

  return (
    <div className="relative px-1.5 pb-1 pt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label="Dispersión de corridas: costo contra tiempo, en escala logarítmica">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={plotRight} y1={yOfCost(v)} y2={yOfCost(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={L - 8} y={yOfCost(v) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {formatUsd(v)}
            </text>
          </g>
        ))}

        <line x1={L} x2={plotRight} y1={laneTop} y2={laneTop} stroke="var(--grid)" strokeWidth={1} strokeDasharray="2 3" />
        <rect x={L} y={laneTop} width={plotRight - L} height={LANE_H} fill="var(--muted)" opacity={0.3} />
        <text x={L - 8} y={(laneTop + laneBottom) / 2 + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
          Sin precio
        </text>

        {dateTicks.map((ms, i) => (
          <text key={i} x={xOf(ms)} y={dateY} textAnchor={i === 0 ? "start" : i === dateTicks.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
            {formatCivilShort(civilDate(new Date(ms), timeZone))}
          </text>
        ))}

        {points.map((p) => {
          const x = xOf(p.createdAtMs);
          const y = p.lane === "cost" ? yOfCost(p.costUsd as number) : yOfNone(p.id);
          const r = pointRadius(p.totalTokens, maxTokens);
          const color = p.ok ? "var(--good)" : "var(--bad)";
          const costText = p.lane === "cost" ? formatUsd(p.costUsd) : p.costUsd === 0 ? "sin costo (sin uso que facturar)" : "sin precio cargado";
          const when = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short", timeZone }).format(p.createdAtMs);
          const title = `${p.ok ? "Terminó bien" : "Terminó con error"} · ${seriesLabel(seriesKeyFor(p.source))} · ${RUN_STATUS_LABELS[p.status] ?? p.status} · ${costText} · ${when}`;
          return (
            <a key={p.id} href={`/dashboard/agents/runs/${p.id}`} aria-label={title}>
              {p.ok ? (
                <circle cx={x} cy={y} r={r} fill={color} fillOpacity={0.72} stroke={color} strokeWidth={1}>
                  <title>{title}</title>
                </circle>
              ) : (
                <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={color} fillOpacity={0.78} stroke={color} strokeWidth={1} transform={`rotate(45 ${x} ${y})`}>
                  <title>{title}</title>
                </rect>
              )}
            </a>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--good)" }} aria-hidden />
          Terminó bien
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rotate-45" style={{ background: "var(--bad)" }} aria-hidden />
          Error o escalada
        </span>
        <span>El radio es por tokens de la corrida.</span>
      </div>
    </div>
  );
}
