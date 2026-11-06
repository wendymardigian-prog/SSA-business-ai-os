"use client";

import Link from "next/link";
import { BarChart2, ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { DetailLevel } from "@/lib/dashboards/ads-detail";
import type { EmptyDetailPageData } from "@/lib/dashboards/ads-detail-page";
import { periodQuery } from "@/lib/dashboards/period-filter";
import { HeaderFilters, RefreshButton } from "./header-controls";
import { useAdsNavigation } from "./use-ads-navigation";

const ROUTE: Record<DetailLevel, string> = {
  campaign: "/dashboard/dashboards/ads/campaigns/[id]",
  adset: "/dashboard/dashboards/ads/adsets/[id]",
  ad: "/dashboard/dashboards/ads/ads/[id]",
};

/**
 * El detalle de un objeto que existe pero no tuvo datos en el rango elegido. No es un error: con el selector a mano se
 * puede elegir otro rango sin perder el lugar.
 */
export function AdsDetailEmpty({ level, adAccountId, period }: { level: DetailLevel } & EmptyDetailPageData) {
  const { pending, navigate, applyPeriod, refresh } = useAdsNavigation();

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route={ROUTE[level]}
        backHref={
          <Link
            href={`/dashboard/dashboards/ads?${periodQuery(period, { cuenta: adAccountId })}`}
            aria-label="Volver a Meta Ads"
            title="Volver a Meta Ads"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
        filters={<HeaderFilters accounts={[]} adAccountId={adAccountId} period={period} onChange={navigate} onApplyPeriod={applyPeriod} />}
        right={<RefreshButton refreshing={pending} onRefresh={refresh} />}
      />
      <div className={`flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center transition-opacity ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
        <BarChart2 className="h-8 w-8 text-muted-foreground opacity-40" aria-hidden />
        <p className="text-sm font-medium">Sin actividad en este período</p>
        <p className="text-xs text-muted-foreground">No hay datos de Meta en el rango elegido. Probá con otro período.</p>
      </div>
    </div>
  );
}
