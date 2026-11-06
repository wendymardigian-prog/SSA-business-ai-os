"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { computeTotals } from "@/lib/dashboards/ads";
import type { AdsTablePageData } from "@/lib/dashboards/ads-table-page";
import { ConnectMetaAdsCard, UniqueReachNotice } from "./ads/ads-page-notices";
import { HeaderFilters, RefreshButton, SyncedPill } from "./ads/header-controls";
import { HierarchyCard } from "./ads/hierarchy-tables";
import { useAdsNavigation } from "./ads/use-ads-navigation";

/** Esta pantalla no usa el alcance por objeto: la tabla «Meta vs CRM» no lo lee (solo el de la cuenta, para el total). */
const NO_OBJECT_REACH = { campaign: null, adset: null, ad: null };

/** La pantalla Anuncios: la tabla de campañas, conjuntos y anuncios, con sus filtros de cuenta y periodo. */
export function AdsTablePage(props: AdsTablePageData) {
  const { pending, navigate, refresh } = useAdsNavigation();
  const totals = useMemo(
    () => computeTotals(props.rows.filter((r) => r.level === "account"), props.uniqueReach),
    [props.rows, props.uniqueReach],
  );

  if (props.accounts.length === 0 || !props.crm) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader route="/dashboard/anuncios" />
        <ConnectMetaAdsCard />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/anuncios"
        left={<SyncedPill label={props.syncedLabel} />}
        filters={<HeaderFilters accounts={props.accounts} adAccountId={props.adAccountId} period={props.period} onChange={navigate} />}
        right={<RefreshButton refreshing={pending} onRefresh={refresh} />}
      />

      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-4 transition-opacity sm:p-6 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
        {props.liveError && <UniqueReachNotice error={props.liveError} />}
        <HierarchyCard
          levels={["campaign", "adset", "ad"]}
          rows={props.rows}
          totals={totals}
          uniqueReach={NO_OBJECT_REACH}
          currency={props.currency}
          adAccountId={props.adAccountId}
          period={props.period}
          crm={props.crm}
        />
      </div>
    </div>
  );
}
