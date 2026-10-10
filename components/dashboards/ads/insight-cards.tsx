"use client";

import { useState, type ReactNode } from "react";
import { AlertCircle, Target, TrendingUp, VideoOff, Zap } from "lucide-react";
import { count, ctrTone, money, percent, videoRetention, videoTotals, type AdsRow } from "@/lib/dashboards/ads";
import { aggregateActions, deviceSummary, placementSummary, type Rankings } from "@/lib/dashboards/ads-view";
import { rankingTone } from "@/lib/dashboards/ads-view";
import type { BreakdownRow, LiveResult } from "@/lib/meta/live";
import { MiniToggle } from "./toggles";

/**
 * Las tarjetas chicas de la grilla de cuatro: Acciones, Placement,
 * Dispositivo y Video (y, en un anuncio, Rankings).
 *
 * Placement y dispositivo vienen de Meta EN VIVO: cada una recibe su propio
 * resultado, asi que si una falla, solo esa tarjeta lo dice y las demas se
 * ven igual.
 */

/** El resultado de un pedido en vivo. Null: no hay con que pedirlo (sin token o sin periodo). */
export type Live<T> = LiveResult<T> | null;

const CARD = "space-y-3 rounded-xl border border-border bg-card p-3";
const EMPTY = "flex h-[140px] items-center justify-center text-xs text-muted-foreground";

function Title({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <span className="text-primary">{icon}</span> {children}
    </h3>
  );
}

/** Lo que muestra una tarjeta en vivo cuando Meta no contesto. */
export function LiveError({ result, className = EMPTY }: { result: Live<unknown>; className?: string }) {
  if (result && !result.ok) {
    return (
      <div className={`${className} flex-col gap-2 text-center`} role="alert">
        <AlertCircle className="h-5 w-5 text-amber-500" aria-hidden />
        No se pudo leer de Meta: {result.error}
      </div>
    );
  }
  return <div className={className}>Sin datos para el período seleccionado</div>;
}

/** Barrita horizontal de una fila. */
function Bar({ percent: width, className = "w-12" }: { percent: number; className?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded bg-muted ${className}`} aria-hidden>
      <div className="h-full rounded bg-primary" style={{ width: `${Math.min(Math.max(width, 0), 100)}%` }} />
    </div>
  );
}

const compactCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ── Acciones generadas ───────────────────────────────────────────────────

export function ActionsCard({ rows }: { rows: AdsRow[] }) {
  const actions = aggregateActions(rows);
  const max = Math.max(...actions.map((a) => a.value), 1);

  return (
    <section className={CARD} aria-label="Acciones generadas">
      <Title icon={<Zap className="h-4 w-4" aria-hidden />}>Acciones generadas</Title>
      {actions.length === 0 ? (
        <div className={EMPTY}>Sin datos para el período seleccionado</div>
      ) : (
        <div className="space-y-1.5">
          {actions.map((a) => (
            <div key={a.type} className="flex items-center gap-2 text-xs">
              <div className="min-w-0 flex-1 truncate text-muted-foreground" title={a.label}>
                {a.label}
              </div>
              <Bar percent={(a.value / max) * 100} className="w-16" />
              <div className="w-12 text-right font-medium text-foreground">{compactCount(a.value)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Placement ────────────────────────────────────────────────────────────

export function PlacementCard({ result, currency }: { result: Live<BreakdownRow[]>; currency: string | null }) {
  const [toggle, setToggle] = useState<"spend" | "ctr">("spend");
  const rows = result?.ok ? result.data : [];
  const { items, best, worst } = placementSummary(rows, toggle);

  return (
    <section className={CARD} aria-label="Por placement">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Title icon={<Target className="h-4 w-4" aria-hidden />}>Por placement</Title>
        <MiniToggle
          label="Ordenar placements por"
          value={toggle}
          onChange={setToggle}
          options={[
            { value: "spend", label: "Gasto" },
            { value: "ctr", label: "CTR" },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <LiveError result={result} />
      ) : (
        <>
          <div className="space-y-1.5">
            {items.map((p) => (
              <div key={p.name} className="flex items-center gap-2 text-xs">
                <div className="min-w-0 flex-1 truncate capitalize text-muted-foreground" title={p.name}>
                  {p.name}
                </div>
                <Bar percent={p.share} />
                <div className="w-14 text-right font-medium text-foreground">
                  {toggle === "spend" ? money(p.spend, currency, { narrow: true }) : percent(p.ctr)}
                </div>
              </div>
            ))}
          </div>
          {best && (
            <div className="space-y-0.5 border-t border-border pt-2 text-[10px]">
              <p className="truncate capitalize text-green-600">▲ {best.name} {percent(best.ctr)}</p>
              {worst && <p className="truncate capitalize text-destructive">▼ {worst.name} {percent(worst.ctr)}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Dispositivo ──────────────────────────────────────────────────────────

const CTR_CLASS = { good: "text-green-600", bad: "text-destructive", neutral: "text-muted-foreground" } as const;

export function DeviceCard({ result, currency }: { result: Live<BreakdownRow[]>; currency: string | null }) {
  const rows = result?.ok ? result.data : [];
  const items = deviceSummary(rows);

  return (
    <section className={CARD} aria-label="Por dispositivo">
      <Title icon={<TrendingUp className="h-4 w-4" aria-hidden />}>Por dispositivo</Title>
      {items.length === 0 ? (
        <LiveError result={result} />
      ) : (
        <>
          <div className="space-y-1.5">
            {items.map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <div className="min-w-0 flex-1 truncate text-muted-foreground">{d.name}</div>
                <Bar percent={d.share ?? 0} />
                <div className="w-14 text-right font-medium text-foreground">{money(d.spend, currency, { narrow: true })}</div>
                <div className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">
                  {d.share === null ? "—" : `${d.share.toFixed(0)}%`}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1 border-t border-border pt-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">CTR</p>
            {items.map((d) => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <span className="truncate text-foreground">{d.name}</span>
                <span className={CTR_CLASS[ctrTone(d.ctr)]}>{percent(d.ctr)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ── Retencion de video ───────────────────────────────────────────────────

export function VideoCard({ rows }: { rows: AdsRow[] }) {
  const totals = videoTotals(rows);
  const stages = videoRetention(totals);

  return (
    <section className={CARD} aria-label="Retención de video">
      <Title icon={<Zap className="h-4 w-4" aria-hidden />}>Retención de video</Title>
      {stages.length === 0 ? (
        <div className={`${EMPTY} flex-col gap-2`}>
          <VideoOff className="h-7 w-7 opacity-40" aria-hidden /> Sin datos de video
        </div>
      ) : (
        <>
          <div className="flex h-[95px] items-end justify-between gap-1 pt-5">
            {stages.map((s) => (
              <div key={s.label} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[9px] font-bold text-foreground">{s.percent === null ? "—" : `${s.percent.toFixed(0)}%`}</span>
                <div
                  className="w-full rounded-t bg-primary"
                  style={{ height: `${s.percent === null ? 2 : Math.max((Math.min(s.percent, 100) / 100) * 75, 2)}px` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between gap-1">
            {stages.map((s) => (
              <span key={s.label} className="flex-1 text-center text-[9px] text-muted-foreground">
                {s.label}
              </span>
            ))}
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-[11px]">
            <span className="text-muted-foreground">
              T. prom <span className="font-semibold text-foreground">{totals.avgTimeSeconds === null ? "—" : `${totals.avgTimeSeconds.toFixed(1)}s`}</span>
            </span>
            <span className="text-muted-foreground">
              Thru <span className="font-semibold text-foreground">{count(totals.thruplays)}</span>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

// ── Rankings (anuncio) ───────────────────────────────────────────────────

const RANKING_VIEW = {
  above: { text: "▲ Superior", bar: "bg-green-500", width: 85, tone: "font-medium text-green-600" },
  average: { text: "— Promedio", bar: "bg-yellow-400", width: 50, tone: "text-muted-foreground" },
  below: { text: "▼ Inferior", bar: "bg-red-500", width: 20, tone: "font-medium text-destructive" },
} as const;

function RankingBar({ label, value }: { label: string; value: string | null }) {
  const tone = rankingTone(value);
  const view = tone ? RANKING_VIEW[tone] : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={view?.tone ?? "text-muted-foreground"}>{view?.text ?? "Sin datos"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${view?.bar ?? "bg-muted"}`} style={{ width: `${view?.width ?? 0}%` }} />
      </div>
    </div>
  );
}

export function RankingsCard({ rankings }: { rankings: Rankings | null }) {
  const has = rankings && (rankings.quality || rankings.engagement || rankings.conversion);
  return (
    <section className={CARD} aria-label="Rankings">
      <Title icon={<TrendingUp className="h-4 w-4" aria-hidden />}>Rankings</Title>
      {!has ? (
        <div className={EMPTY}>Sin datos para el período seleccionado</div>
      ) : (
        <div className="space-y-3 pt-1">
          <RankingBar label="Calidad" value={rankings.quality} />
          <RankingBar label="Engagement" value={rankings.engagement} />
          <RankingBar label="Conversión" value={rankings.conversion} />
        </div>
      )}
    </section>
  );
}
