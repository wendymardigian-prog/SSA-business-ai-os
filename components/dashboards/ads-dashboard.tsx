"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { DashboardSwitcher } from "./dashboard-switcher";
import type { DashboardOption } from "@/lib/dashboards/available";
import { ConnectMetaAdsCard, ReachAheadNote, UniqueReachNotice } from "./ads/ads-page-notices";
import { EvolutionCard } from "./ads/evolution-card";
import { buildKpiItems } from "./ads/kpi-items";
import { HeaderActions, HeaderFilters, SyncedPill } from "./ads/header-controls";
import { AudienceCard } from "./ads/audience-card";
import { ComparisonCards } from "./ads/comparison-cards";
import { DailyTableCard } from "./ads/daily-table";
import { HierarchyCard } from "./ads/hierarchy-tables";
import { ActionsCard, DeviceCard, PlacementCard, VideoCard, type Live } from "./ads/insight-cards";
import type { BreakdownRow } from "@/lib/meta/live";
import { KpiRow } from "./ads/kpi-row";
import { useAdsNavigation } from "./ads/use-ads-navigation";
import { AdsAiPanel } from "./ads-ai-panel";
import type { PeriodFilter } from "@/lib/dashboards/period-filter";
import type { CrmTableData } from "@/lib/dashboards/ads-crm-load";
import { computeTotals, type AdsRow } from "@/lib/dashboards/ads";
import { crmLeadsSummary } from "@/lib/dashboards/ads-crm";

/**
 * El dashboard de Meta Ads: la réplica de un panel de Ads de referencia.
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
  period: PeriodFilter;
  /** El alcance unico del periodo, de la consulta en vivo (F58). */
  uniqueReach: number | null;
  /** La frecuencia de la misma respuesta de Meta que `uniqueReach`. */
  uniqueFrequency: number | null;
  /** El del periodo anterior; solo viene si el de este llego tambien. */
  previousUniqueReach: number | null;
  liveError: string | null;
  /** Los desgloses que se piden a Meta en vivo, cada uno por su cuenta. */
  live: { placement: Live<BreakdownRow[]>; device: Live<BreakdownRow[]>; audience: Live<BreakdownRow[]> };
  /** Alcance unico de cada anuncio (en vivo), para la comparativa. Null si Meta no respondio. */
  adReach: Record<string, number> | null;
  /** El modelo elegido para el analisis de IA ("proveedor/modelo"); null = el del negocio. */
  aiModel: string | null;
  /** "hoy 14:32": cuando escribio el sync por ultima vez. Armado en el servidor. */
  syncedLabel: string | null;
  /** Los dashboards que puede abrir quien esta mirando (B3). */
  dashboards: DashboardOption[];
  /** Puede pedir "Sincronizar ahora" (`settings.general`). */
  canSync?: boolean;
  /** Lo que dice el CRM (AT4): con esto las tres tablas son «Meta vs CRM». Sin esto, la tabla de siempre. */
  crm?: CrmTableData;
}

const SECTION_LABEL = "text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

export function AdsDashboard(props: AdsDashboardProps) {
  const { pending, navigate, applyPeriod, refresh } = useAdsNavigation();

  const [aiOpen, setAiOpen] = useState(false);
  const accountRows = useMemo(() => props.rows.filter((r) => r.level === "account"), [props.rows]);

  const totals = useMemo(
    () => computeTotals(accountRows, props.uniqueReach, props.uniqueFrequency),
    [accountRows, props.uniqueReach, props.uniqueFrequency],
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
        <ConnectMetaAdsCard />
      </div>
    );
  }

  const crmLeads =
    props.crm && !props.crm.error
      ? crmLeadsSummary({ metrics: props.crm.metrics.campaign, distinct: props.crm.distinct.campaign, spend: totals.spend })
      : null;
  const kpis = buildKpiItems({ totals, previous: previousTotals, currency: props.currency, crmLeads });

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
            onApplyPeriod={applyPeriod}
          />
        }
        right={
          <HeaderActions
            refreshing={pending}
            onRefresh={refresh}
            onOpenAi={() => setAiOpen(true)}
            account={props.account}
            syncedLabel={props.syncedLabel}
            canSync={props.canSync}
          />
        }
      />

      <div
        className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-4 transition-opacity sm:p-6 ${pending ? "opacity-60" : ""}`}
        aria-busy={pending}
      >
        {props.liveError && <UniqueReachNotice error={props.liveError} />}

        <section className="space-y-2" aria-label="Resumen">
          <p className={SECTION_LABEL}>Resumen</p>
          <KpiRow items={kpis} />
          <ReachAheadNote totals={totals} />
        </section>

        <EvolutionCard rows={accountRows} currency={props.currency} />

        <ComparisonCards variant="campaigns" rows={props.rows} currency={props.currency} adReach={props.adReach} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionsCard rows={accountRows} />
          <PlacementCard result={props.live.placement} currency={props.currency} />
          <DeviceCard result={props.live.device} currency={props.currency} />
          <VideoCard rows={accountRows} />
        </div>

        <AudienceCard result={props.live.audience} />

        {props.crm && (
          <HierarchyCard
            levels={["campaign", "adset", "ad"]}
            rows={props.rows}
            totals={totals}
            currency={props.currency}
            adAccountId={props.adAccountId}
            period={props.period}
            crm={props.crm}
          />
        )}

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
