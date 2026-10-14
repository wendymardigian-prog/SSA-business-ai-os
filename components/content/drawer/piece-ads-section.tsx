"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/dashboards/ads";
import { PERIOD_LABELS, type PeriodPreset } from "@/lib/dashboards/period";
import { loadPieceAdsSummary } from "@/lib/actions/content-ad-link";
import { summaryTiles, type LinkedAd, type PieceAdsSummary } from "@/lib/meta/content-ad-summary";

/**
 * La sección «Publicidad» del detalle de una pieza (Tirón 2, A2). El servidor solo la arma cuando la pieza tiene al menos
 * un anuncio vinculado; sin anuncio, el detalle queda exactamente igual que antes.
 *
 * Los números se piden al abrir y al cambiar el período (nunca por adelantado) y salen de la misma función que la tabla
 * Meta vs CRM. Lo que no existe se muestra como «—». El período empieza en «Histórico» (desde que existe).
 */

const PERIODS: PeriodPreset[] = ["historico", "este-mes", "mes-pasado", "30d", "90d", "este-ano"];
const COUNT = new Intl.NumberFormat("es-AR");

type State =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; summary: PieceAdsSummary; currency: string | null };

export function PieceAdsSection({ pieceId, ads }: { pieceId: string; ads: LinkedAd[] }) {
  const [period, setPeriod] = useState<PeriodPreset>("historico");
  const [state, setState] = useState<State>({ status: "loading" });
  const requestId = useRef(0);

  const fetchFor = useCallback(
    (value: PeriodPreset) => loadPieceAdsSummary({ pieceId, period: value }),
    [pieceId],
  );
  const apply = useCallback((id: number, res: Awaited<ReturnType<typeof loadPieceAdsSummary>>) => {
    if (id !== requestId.current) return;
    setState(res.ok ? { status: "ready", summary: res.summary, currency: res.currency } : { status: "error", error: res.error });
  }, []);

  // La primera carga, al abrir (el estado inicial ya es «cargando»).
  useEffect(() => {
    const id = ++requestId.current;
    let live = true;
    void fetchFor("historico").then((res) => {
      if (live) apply(id, res);
    });
    return () => {
      live = false;
    };
  }, [fetchFor, apply, ads.length]);

  function load(value: PeriodPreset) {
    const id = ++requestId.current;
    setState({ status: "loading" });
    void fetchFor(value).then((res) => apply(id, res));
  }

  return (
    <section aria-labelledby="publicidad" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="publicidad" className="text-sm font-semibold">
          Publicidad
        </h2>
        <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <span className="sr-only">Período de la publicidad</span>
          <select
            value={period}
            onChange={(e) => {
              const next = e.target.value as PeriodPreset;
              setPeriod(next);
              load(next);
            }}
            aria-label="Período de la publicidad"
            className="h-7 rounded-lg border border-border bg-background px-2 text-xs"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.status === "loading" && (
        <p role="status" className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          Cargando la publicidad…
        </p>
      )}

      {state.status === "error" && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <p>{state.error}</p>
          <button type="button" onClick={() => load(period)} className="h-7 rounded-lg border border-border px-2.5 hover:bg-accent">
            Reintentar
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <div className="space-y-2">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {summaryTiles(state.summary, {
              money: (value) => money(value, state.currency, { narrow: true }),
              count: (value) => (value === null ? "—" : COUNT.format(value)),
            }).map((tile) => (
              <div key={tile.key} className="rounded-lg border border-border px-3 py-2" title={tile.tip}>
                <dt className="text-[11px] text-muted-foreground">{tile.label}</dt>
                <dd className="text-sm font-semibold tabular-nums">{tile.value}</dd>
              </div>
            ))}
          </dl>
          {state.summary.notes.map((note) => (
            <p key={note} className="text-[11px] text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground">{ads.length === 1 ? "Anuncio vinculado" : `Anuncios vinculados (${ads.length})`}</h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {ads.map((ad) => (
            <li key={ad.adId}>
              <Link href={ad.href} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none">
                <span className="min-w-0 flex-1 truncate font-medium">{ad.name ?? ad.adId}</span>
                {ad.status && <span className="shrink-0 text-[11px] text-muted-foreground">{ad.status}</span>}
                <span className="shrink-0 text-[11px] text-muted-foreground">{ad.manual ? "a mano" : "automático"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
