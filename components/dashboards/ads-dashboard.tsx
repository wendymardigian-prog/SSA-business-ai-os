"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DashboardSwitcher } from "./dashboard-switcher";
import type { DashboardOption } from "@/lib/dashboards/available";
import { EvolutionCard } from "./ads/evolution-card";
import { buildKpiItems } from "./ads/kpi-items";
import { HeaderActions, HeaderFilters, SyncedPill } from "./ads/header-controls";
import { AudienceCard } from "./ads/audience-card";
import { ComparisonCards } from "./ads/comparison-cards";
import { DailyTableCard } from "./ads/daily-table";
import { HierarchyCard, type UniqueReach } from "./ads/hierarchy-tables";
import { ActionsCard, DeviceCard, PlacementCard, VideoCard, type Live } from "./ads/insight-cards";
import type { BreakdownRow } from "@/lib/meta/live";
import { KpiRow } from "./ads/kpi-row";
import { useAdsNavigation } from "./ads/use-ads-navigation";
import { AdsAiPanel } from "./ads-ai-panel";
import type { PeriodPreset } from "@/lib/dashboards/period";
import { computeTotals, type AdsRow } from "@/lib/dashboards/ads";

/**
 * El dashboard de Meta Ads: la réplica del panel de Ads de wendymardigian.
 *
 * Todas las cuentas salen de `lib/dashboards/ads.ts` y `ads-view.ts`, que
 * son puros y estan probados; este componente solo las pinta. La regla que
 * manda en toda la pantalla: **una cifra que no se puede calcular es una
 * raya, no un cero**.
 */

export interface AdsDashboardProps {
  rows: AdsRow[];
  previousRows: AdsRow[];
  accounts: Array<{ id: string; name: string | null; currency: string | null }>;
  /** La cuenta elegida, con lo que muestra el engranaje. Null si no hay ninguna. */
  account: { id: string; name: string | null; currency: string | null; lastError: string | null } | null;
  adAccountId: string;
  currency: string | null;
  period: PeriodPreset;
  /** El alcance unico del periodo, de la consulta en vivo (F58). */
  uniqueReach: number | null;
  /** El del periodo anterior; solo viene si el de este llego tambien. */
  previousUniqueReach: number | null;
  liveError: string | null;
  /** Los desgloses que se piden a Meta en vivo, cada uno por su cuenta. */
  live: { placement: Live<BreakdownRow[]>; device: Live<BreakdownRow[]>; audience: Live<BreakdownRow[]> };
  /** Alcance unico de cada campaña, conjunto y anuncio (en vivo). Null si Meta no respondio. */
  reach: UniqueReach;
  /** El modelo elegido para el analisis de IA ("proveedor/modelo"); null = el del negocio. */
  aiModel: string | null;
  /** "hoy 14:32": cuando escribio el sync por ultima vez. Armado en el servidor. */
  syncedLabel: string | null;
  /** Los dashboards que puede abrir quien esta mirando (B3). */
  dashboards: DashboardOption[];
}

const SECTION_LABEL = "text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

export function AdsDashboard(props: AdsDashboardProps) {
  const { pending, navigate, refresh } = useAdsNavigation();

  const [aiOpen, setAiOpen] = useState(false);
  const accountRows = useMemo(() => props.rows.filter((r) => r.level === "account"), [props.rows]);

  const totals = useMemo(
    () => computeTotals(accountRows, props.uniqueReach),
    [accountRows, props.uniqueReach],
  );

  const previousTotals = useMemo(
    () =>
      computeTotals(
        props.previousRows.filter((r) => r.level === "account"),
        props.previousUniqueReach,
      ),
    [props.previousRows, props.previousUniqueReach],
  );


  if (props.accounts.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader route="/dashboard/dashboards/ads" left={<DashboardSwitcher options={props.dashboards} />} />
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="w-full max-w-xl space-y-6 rounded-2xl border border-border bg-card p-6">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
              <BarChart2 className="h-7 w-7 text-primary" aria-hidden />
            </div>
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-bold">Conectar Meta Ads</h2>
              <p className="text-sm text-muted-foreground">
                Todavía no hay ninguna cuenta publicitaria sincronizando. Conectá Meta y elegí cuáles
                querés ver acá para seguir el rendimiento de tus campañas.
              </p>
            </div>
            <Link
              href="/dashboard/settings/integrations"
              className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Ir a Integraciones
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const kpis = buildKpiItems({ totals, previous: previousTotals, currency: props.currency });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/dashboards/ads"
        left={
          <>
            <DashboardSwitcher options={props.dashboards} />
            <SyncedPill label={props.syncedLabel} />
          </>
        }
        filters={
          <HeaderFilters
            accounts={props.accounts}
            adAccountId={props.adAccountId}
            period={props.period}
            onChange={navigate}
          />
        }
        right={
          <HeaderActions
            refreshing={pending}
            onRefresh={refresh}
            onOpenAi={() => setAiOpen(true)}
            account={props.account}
            syncedLabel={props.syncedLabel}
          />
        }
      />

      <div
        className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-4 transition-opacity sm:p-6 ${pending ? "opacity-60" : ""}`}
        aria-busy={pending}
      >
        {props.liveError && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            El alcance unico del periodo no se pudo leer: {props.liveError}. Lo que se muestra es la
            suma de los dias, que cuenta dos veces a quien vio el anuncio en dos dias distintos.
          </p>
        )}

        <section className="space-y-2" aria-label="Resumen">
          <p className={SECTION_LABEL}>Resumen</p>
          <KpiRow items={kpis} />
        </section>

        <EvolutionCard rows={accountRows} currency={props.currency} />

        <ComparisonCards variant="campaigns" rows={props.rows} currency={props.currency} adReach={props.reach.ad} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionsCard rows={accountRows} />
          <PlacementCard result={props.live.placement} currency={props.currency} />
          <DeviceCard result={props.live.device} currency={props.currency} />
          <VideoCard rows={accountRows} />
        </div>

        <AudienceCard result={props.live.audience} />

        <HierarchyCard
          levels={["campaign", "adset", "ad"]}
          rows={props.rows}
          totals={totals}
          uniqueReach={props.reach}
          currency={props.currency}
          adAccountId={props.adAccountId}
          period={props.period}
        />

        <DailyTableCard rows={accountRows} totals={totals} currency={props.currency} />
      </div>

      {aiOpen && (
        <AdsAiPanel
          period={props.period}
          adAccountId={props.adAccountId}
          chosenModel={props.aiModel}
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  );
}
