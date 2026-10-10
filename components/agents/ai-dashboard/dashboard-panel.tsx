"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ListFilter } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiKpiCards } from "./kpi-cards";
import { SpendChartTabs } from "./spend-chart-tabs";
import type { AiKpiCards as AiKpiCardsData } from "@/lib/agent/ai-dashboard/kpis";
import type { SpendByDayRow } from "@/lib/agent/ai-dashboard/spend-chart";
import type { SystemStatus } from "@/lib/agent/ai-dashboard/system-status";

const STORAGE_KEY = "app.ai.dashboard.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Ventana privada u otro bloqueo: se renderiza desplegado (A6).
    return false;
  }
}

/**
 * El mini dashboard entero (A6): plegable por navegador, nunca por la base.
 * Esta es la UNICA parte del dashboard que es cliente de verdad (el resto son
 * props ya resueltas en el servidor): el resto de la pagina no necesita
 * re-renderizarse para plegar o desplegar.
 */
export function AiDashboardPanel({
  cards,
  systemStatus,
  periodQuery,
  firstAgentId,
  spendByDay,
  timeZone,
  range,
  hasAnyRuns,
  limitsCard,
}: {
  cards: AiKpiCardsData;
  systemStatus: SystemStatus;
  periodQuery: string;
  firstAgentId: string | null;
  spendByDay: SpendByDayRow[];
  timeZone: string;
  range: { from: string | null; to: string | null };
  /** Para el estado vacio: con cero corridas, las tarjetas muestran — y no se dibuja un grafico con ejes. */
  hasAnyRuns: boolean;
  /** La tarjeta "Topes y avisos": llega ya armada del servidor. */
  limitsCard?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // El primer render (servidor y cliente) es siempre desplegado, para que no
  // haya un salto de layout por hidratacion. Si la preferencia guardada es
  // "plegado", se pliega apenas monta: un parpadeo mucho mas chico que dejar
  // la seccion en blanco hasta leer localStorage.
  useEffect(() => {
    if (readCollapsed()) setCollapsed(true);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Sin localStorage, simplemente no se recuerda entre visitas.
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-border">
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={toggle} aria-expanded={!collapsed} className="flex flex-1 items-center justify-between gap-2 text-sm font-medium">
          <span>Gasto de IA</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")} aria-hidden />
        </button>
        <Link
          href={`/dashboard/agents/runs${periodQuery ? `?${periodQuery}` : ""}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ListFilter className="h-3.5 w-3.5" aria-hidden />
          Ver corridas
        </Link>
      </div>

      {!collapsed && (
        <div className="space-y-4 border-t border-border p-4">
          {hasAnyRuns ? (
            <>
              <AiKpiCards cards={cards} periodQuery={periodQuery} firstAgentId={firstAgentId} systemStatus={{ status: systemStatus }} />
              {/*
                `key` por rango: sin esto, al cambiar de periodo React
                conserva la instancia del grafico (es el mismo componente en
                el mismo lugar del arbol) y la dispersion que ya se habia
                pedido para el periodo VIEJO se queda en pantalla. El `key`
                fuerza un componente nuevo, que pide la suya.
              */}
              <SpendChartTabs key={`${range.from ?? ""}|${range.to ?? ""}`} spendByDay={spendByDay} timeZone={timeZone} range={range} />
            </>
          ) : (
            <div className="space-y-4">
              <AiKpiCards cards={cards} periodQuery={periodQuery} firstAgentId={firstAgentId} systemStatus={{ status: systemStatus }} />
              <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
                Todavía no hay corridas en este período.
              </div>
            </div>
          )}
          {limitsCard}
        </div>
      )}
    </section>
  );
}

/** El esqueleto de carga (A6), con la misma altura que el contenido final para que la lista no salte. */
export function AiDashboardSkeleton() {
  return (
    <section className="mb-6 animate-pulse rounded-xl border border-border p-4">
      <div className="mb-4 h-5 w-32 rounded bg-muted/60" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-24 rounded-[14px] bg-muted/40" />
        ))}
      </div>
      <div className="mt-4 h-64 rounded-xl bg-muted/40" />
    </section>
  );
}
