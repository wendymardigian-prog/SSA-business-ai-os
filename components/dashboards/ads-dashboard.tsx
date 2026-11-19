"use client";

import { Suspense, use, useMemo, useState, type ReactNode } from "react";
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
import { computePreviousTotals, computeTotals, type AdsRow, type AdsTotalsWithSource } from "@/lib/dashboards/ads";
import { crmLeadsSummary } from "@/lib/dashboards/ads-crm";
import type { DashboardReach } from "@/lib/dashboards/ads-live";
import { periodQuery } from "@/lib/dashboards/period-filter";
import { BlockSkeleton } from "./chat/block";

/**
 * El dashboard de Meta Ads: la réplica de un panel de Ads de referencia.
 *
 * Todas las cuentas salen de `lib/dashboards/ads.ts` y `ads-view.ts`, que
 * son puros y estan probados; este componente solo las pinta. La regla que
 * manda en toda la pantalla: **una cifra que no se puede calcular es una
 * raya, no un cero**.
 *
 * Lo que se pide a Meta en vivo y el CRM llegan como promesas (como el
 * dashboard de Chat): la cabecera y lo guardado se dibujan enseguida, y cada
 * tarjeta que depende de algo en vivo lo lee con `use()` adentro de su
 * `Suspense`, con un skeleton mientras tanto. Ninguna tarjeta muestra un
 * numero provisorio: lo que depende del alcance en vivo espera al alcance.
 */

/** Lo que se pide en vivo, sin esperar. Ninguna rechaza (`neverRejects`): lo que falla llega como null o con su error. */
export interface AdsLivePromises {
  /** El alcance unico del periodo y del anterior (F58). */
  reach: Promise<DashboardReach>;
  /** Alcance unico de cada anuncio (en vivo), para la comparativa. Null si Meta no respondio. */
  adReach: Promise<Record<string, number> | null>;
  /** Los desgloses que se piden a Meta en vivo, cada uno por su cuenta. */
  placement: Promise<Live<BreakdownRow[]>>;
  device: Promise<Live<BreakdownRow[]>>;
  audience: Promise<Live<BreakdownRow[]>>;
  /** Lo que dice el CRM (AT4): con esto las tres tablas son «Meta vs CRM». */
  crm: Promise<CrmTableData>;
}

export interface AdsDashboardProps {
  rows: AdsRow[];
  previousRows: AdsRow[];
  accounts: Array<{ id: string; name: string | null; currency: string | null }>;
  /** La cuenta elegida, con lo que muestra el engranaje. Null si no hay ninguna. */
  account: { id: string; name: string | null; currency: string | null; lastError: string | null } | null;
  adAccountId: string;
  currency: string | null;
  period: PeriodFilter;
  /** Lo que se pide en vivo. Null solo si no hay ninguna cuenta. */
  live: AdsLivePromises | null;
  /** El modelo elegido para el analisis de IA ("proveedor/modelo"); null = el del negocio. */
  aiModel: string | null;
  /** "hoy 14:32": cuando escribio el sync por ultima vez. Armado en el servidor. */
  syncedLabel: string | null;
  /** Los dashboards que puede abrir quien esta mirando (B3). */
  dashboards: DashboardOption[];
  /** Puede pedir "Sincronizar ahora" (`settings.general`). */
  canSync?: boolean;
}

const SECTION_LABEL = "text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

export function AdsDashboard(props: AdsDashboardProps) {
  const { pending, navigate, applyPeriod, refresh } = useAdsNavigation();

  const [aiOpen, setAiOpen] = useState(false);
  const accountRows = useMemo(() => props.rows.filter((r) => r.level === "account"), [props.rows]);

  if (props.accounts.length === 0 || !props.live) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader route="/dashboard/dashboards/ads" left={<DashboardSwitcher options={props.dashboards} />} />
        <ConnectMetaAdsCard />
      </div>
    );
  }

  const live = props.live;
  // El `key` de cada tarjeta en vivo: otra cuenta u otro periodo es una tarjeta nueva, con su skeleton, en vez de dejar
  // los numeros viejos a la vista hasta que llegue lo mas lento.
  const loadKey = periodQuery(props.period, { cuenta: props.adAccountId });

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
        <Suspense key={`notice|${loadKey}`} fallback={null}>
          <LiveReachNotice reach={live.reach} />
        </Suspense>

        <section className="space-y-2" aria-label="Resumen">
          <p className={SECTION_LABEL}>Resumen</p>
          <Suspense key={`kpis|${loadKey}`} fallback={<Loading><BlockSkeleton kind="kpis" /></Loading>}>
            <WithTotals reach={live.reach} accountRows={accountRows}>
              {(totals, reach) => (
                <SummaryKpis
                  totals={totals}
                  reach={reach}
                  previousRows={props.previousRows}
                  currency={props.currency}
                  crm={live.crm}
                />
              )}
            </WithTotals>
          </Suspense>
        </section>

        <EvolutionCard rows={accountRows} currency={props.currency} />

        <Suspense key={`comparison|${loadKey}`} fallback={<Loading><BlockSkeleton kind="cards3" /></Loading>}>
          <LiveComparison rows={props.rows} currency={props.currency} adReach={live.adReach} />
        </Suspense>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionsCard rows={accountRows} />
          <Suspense key={`placement|${loadKey}`} fallback={<Loading><BlockSkeleton /></Loading>}>
            <LivePlacement result={live.placement} currency={props.currency} />
          </Suspense>
          <Suspense key={`device|${loadKey}`} fallback={<Loading><BlockSkeleton /></Loading>}>
            <LiveDevice result={live.device} currency={props.currency} />
          </Suspense>
          <VideoCard rows={accountRows} />
        </div>

        <Suspense key={`audience|${loadKey}`} fallback={<Loading><BlockSkeleton kind="chart" /></Loading>}>
          <LiveAudience result={live.audience} />
        </Suspense>

        <Suspense key={`hierarchy|${loadKey}`} fallback={<Loading><BlockSkeleton kind="table" /></Loading>}>
          <WithTotals reach={live.reach} accountRows={accountRows}>
            {(totals) => (
              <LiveHierarchy
                rows={props.rows}
                totals={totals}
                currency={props.currency}
                adAccountId={props.adAccountId}
                period={props.period}
                crm={live.crm}
              />
            )}
          </WithTotals>
        </Suspense>

        <Suspense key={`daily|${loadKey}`} fallback={<Loading><BlockSkeleton kind="table" /></Loading>}>
          <WithTotals reach={live.reach} accountRows={accountRows}>
            {(totals) => <DailyTableCard rows={accountRows} totals={totals} currency={props.currency} />}
          </WithTotals>
        </Suspense>
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

/** Lo que se ve mientras algo viaja desde Meta o el CRM: el skeleton, anunciado a los lectores de pantalla. */
function Loading({ children }: { children: ReactNode }) {
  return (
    <div role="status" aria-label="Cargando">
      {children}
    </div>
  );
}

/** El aviso de que el alcance unico no llego (y por eso se ve la suma de los dias). */
function LiveReachNotice({ reach }: { reach: Promise<DashboardReach> }) {
  const { current } = use(reach);
  return current.liveError ? <UniqueReachNotice error={current.liveError} /> : null;
}

/**
 * Los totales del periodo con el alcance y la frecuencia de Meta. Espera al alcance en vivo: con la suma provisoria de
 * los dias se veria un numero que despues cambia.
 */
function WithTotals({
  reach,
  accountRows,
  children,
}: {
  reach: Promise<DashboardReach>;
  accountRows: AdsRow[];
  children: (totals: AdsTotalsWithSource, reach: DashboardReach) => ReactNode;
}) {
  const resolved = use(reach);
  const { uniqueReach, uniqueFrequency } = resolved.current;
  const totals = useMemo(() => computeTotals(accountRows, uniqueReach, uniqueFrequency), [accountRows, uniqueReach, uniqueFrequency]);
  return <>{children(totals, resolved)}</>;
}

function SummaryKpis({
  totals,
  reach,
  previousRows,
  currency,
  crm: crmPromise,
}: {
  totals: AdsTotalsWithSource;
  reach: DashboardReach;
  previousRows: AdsRow[];
  currency: string | null;
  crm: Promise<CrmTableData>;
}) {
  const crm = use(crmPromise);
  const { uniqueReach, uniqueFrequency } = reach.current;
  const previousTotals = useMemo(
    () =>
      computePreviousTotals(
        previousRows.filter((r) => r.level === "account"),
        { reach: uniqueReach, frequency: uniqueFrequency },
        reach.previous,
      ),
    [previousRows, uniqueReach, uniqueFrequency, reach.previous],
  );

  const crmLeads = !crm.error
    ? crmLeadsSummary({ metrics: crm.metrics.campaign, distinct: crm.distinct.campaign, spend: totals.spend })
    : null;
  const kpis = buildKpiItems({ totals, previous: previousTotals, currency, crmLeads });

  return (
    <>
      <KpiRow items={kpis} />
      <ReachAheadNote totals={totals} />
    </>
  );
}

function LiveComparison({
  rows,
  currency,
  adReach,
}: {
  rows: AdsRow[];
  currency: string | null;
  adReach: Promise<Record<string, number> | null>;
}) {
  return <ComparisonCards variant="campaigns" rows={rows} currency={currency} adReach={use(adReach)} />;
}

function LivePlacement({ result, currency }: { result: Promise<Live<BreakdownRow[]>>; currency: string | null }) {
  return <PlacementCard result={use(result)} currency={currency} />;
}

function LiveDevice({ result, currency }: { result: Promise<Live<BreakdownRow[]>>; currency: string | null }) {
  return <DeviceCard result={use(result)} currency={currency} />;
}

function LiveAudience({ result }: { result: Promise<Live<BreakdownRow[]>> }) {
  return <AudienceCard result={use(result)} />;
}

function LiveHierarchy({
  crm,
  ...rest
}: Omit<Parameters<typeof HierarchyCard>[0], "crm" | "levels"> & { crm: Promise<CrmTableData> }) {
  return <HierarchyCard levels={["campaign", "adset", "ad"]} crm={use(crm)} {...rest} />;
}
