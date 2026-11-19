"use client";

import { Suspense, use, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { computeTotals, money, objectiveLabel, type AdsTotalsWithSource } from "@/lib/dashboards/ads";
import type { CrmRow } from "@/lib/dashboards/ads-crm";
import type { CrmTableData } from "@/lib/dashboards/ads-crm-load";
import { drillTargets } from "@/lib/dashboards/ads-drill";
import { activeFilterChips, applyAdsTableFilters, clearFilters, type AdsTableFilters, type FilterContext } from "@/lib/dashboards/ads-table-filters";
import type { AdsTablePageData } from "@/lib/dashboards/ads-table-page";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";
import { ConnectMetaAdsCard, UniqueReachNotice } from "./ads/ads-page-notices";
import { AdsFiltersMenu, FilterChips, LevelTabs, StatusMenu } from "./ads/ads-table-toolbar";
import { ColumnsMenu } from "./ads/columns-menu";
import { CrmLevelBody, ExportCsvButton, UnmatchedLink, useCrmLevelTable } from "./ads/crm-table";
import { HeaderFilters, RefreshButton, SyncedPill } from "./ads/header-controls";
import { detailHref } from "./ads/hierarchy-tables";
import type { RowAction } from "./ads/row-actions-menu";
import { useAdsNavigation } from "./ads/use-ads-navigation";
import { useAdsTableUrl } from "./ads/use-ads-table-url";
import { BlockSkeleton } from "./chat/block";
import { periodQuery } from "@/lib/dashboards/period-filter";

/**
 * La pantalla Anuncios: la tabla de campañas, conjuntos y anuncios, con todo lo que la controla en la barra superior: la pestaña,
 * el buscador, el estado, los filtros, la cuenta y el período, las columnas, exportar y actualizar.
 *
 * Pestaña, filtros y orden viven en la URL (`use-ads-table-url.ts`): cambiarlos no le pide nada al servidor. Cuenta y período si,
 * porque traen otros datos.
 *
 * El alcance en vivo y el CRM llegan como promesas: mientras viajan se ve la cabecera (cuenta, período, pestaña y
 * actualizar) con un skeleton de la tabla. La tabla espera a los dos para no mostrar un total que despues cambia.
 */
export function AdsTablePage(props: AdsTablePageData) {
  const nav = useAdsNavigation();

  if (props.accounts.length === 0 || !props.crm) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader route="/dashboard/anuncios" />
        <ConnectMetaAdsCard />
      </div>
    );
  }

  // Otra cuenta u otro periodo es una tabla nueva, con su skeleton, en vez de dejar los numeros viejos a la vista.
  const loadKey = periodQuery(props.period, { cuenta: props.adAccountId });
  return (
    <Suspense key={loadKey} fallback={<AdsTableLoading data={props} nav={nav} />}>
      <AdsTableLoaded data={props} crm={props.crm} nav={nav} />
    </Suspense>
  );
}

function AdsTableLoaded({
  data,
  crm: crmPromise,
  nav,
}: {
  data: AdsTablePageData;
  crm: Promise<CrmTableData>;
  nav: ReturnType<typeof useAdsNavigation>;
}) {
  const reach = use(data.reach);
  const crm = use(crmPromise);
  const totals = useMemo(
    () => computeTotals(data.rows.filter((r) => r.level === "account"), reach.uniqueReach, reach.uniqueFrequency),
    [data.rows, reach.uniqueReach, reach.uniqueFrequency],
  );
  return <AdsTableScreen data={data} crm={crm} totals={totals} liveError={reach.liveError} nav={nav} />;
}

/** La cabecera que no depende de lo que viaja (cuenta, período, pestaña, actualizar) y un skeleton de la tabla. */
function AdsTableLoading({ data, nav }: { data: AdsTablePageData; nav: ReturnType<typeof useAdsNavigation> }) {
  const { level, setLevel } = useAdsTableUrl();
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/anuncios"
        filtersBreakpoint="wide"
        left={<SyncedPill label={data.syncedLabel} />}
        tabs={<LevelTabs level={level} onChange={setLevel} />}
        filters={
          <HeaderFilters accounts={data.accounts} adAccountId={data.adAccountId} period={data.period} onChange={nav.navigate} onApplyPeriod={nav.applyPeriod} />
        }
        right={<RefreshButton refreshing={nav.pending} onRefresh={nav.refresh} />}
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-6" role="status" aria-label="Cargando la tabla">
        <BlockSkeleton kind="table" className="min-h-[320px]" />
      </div>
    </div>
  );
}

/** Los nombres que se conocen de cada campaña o conjunto: los del catalogo y, si no, los de las metricas. */
function nameOptions(data: AdsTablePageData, crm: CrmTableData, level: "campaign" | "adset", onlyCampaigns: string[]): MultiFilterOption[] {
  const names = new Map<string, { name: string | null; campaignId: string | null }>();
  for (const row of data.rows) {
    if (row.level === level) names.set(row.objectId, { name: row.objectName, campaignId: row.campaignId });
  }
  for (const [id, entry] of Object.entries(crm.catalog[level])) {
    const before = names.get(id);
    names.set(id, { name: entry.name ?? before?.name ?? null, campaignId: entry.campaignId ?? before?.campaignId ?? null });
  }
  const campaigns = new Set(onlyCampaigns);
  return [...names.entries()]
    .filter(([, entry]) => level === "campaign" || campaigns.size === 0 || (entry.campaignId !== null && campaigns.has(entry.campaignId)))
    .map(([id, entry]) => ({ value: id, label: entry.name || id }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

function AdsTableScreen({
  data,
  crm,
  totals,
  liveError,
  nav,
}: {
  data: AdsTablePageData;
  crm: CrmTableData;
  totals: AdsTotalsWithSource;
  liveError: string | null;
  nav: ReturnType<typeof useAdsNavigation>;
}) {
  const { level, filters, setFilters, setLevel, drillTo } = useAdsTableUrl();
  const { adAccountId, period, currency } = data;

  const ctx = useMemo<FilterContext>(() => {
    const campaignOfAdset = new Map<string, string>();
    for (const row of data.rows) if (row.level === "adset" && row.campaignId) campaignOfAdset.set(row.objectId, row.campaignId);
    for (const [id, entry] of Object.entries(crm.catalog.adset)) if (entry.campaignId) campaignOfAdset.set(id, entry.campaignId);
    return {
      level,
      campaignObjective: (id) => crm.catalog.campaign[id]?.objective ?? null,
      campaignOfAdset: (id) => campaignOfAdset.get(id) ?? null,
    };
  }, [level, data.rows, crm.catalog]);

  const narrow = useCallback((rows: CrmRow[]) => applyAdsTableFilters(rows, filters, ctx), [filters, ctx]);
  const state = useCrmLevelTable({ level, rows: data.rows, totals, crm, status: filters.status, narrow, sort: filters.sort });

  const rowActions = useCallback(
    (row: CrmRow): RowAction[] =>
      drillTargets(level, row).map((target) =>
        target.kind === "drill"
          ? { label: target.label, onSelect: () => drillTo(target.level, target.campaignIds, target.adsetIds) }
          : { label: target.label, href: detailHref(level, row.objectId, adAccountId, period) },
      ),
    [level, drillTo, adAccountId, period],
  );

  const campaignOptions = useMemo(() => nameOptions(data, crm, "campaign", []), [data, crm]);
  const adsetOptions = useMemo(() => nameOptions(data, crm, "adset", filters.campaignIds), [data, crm, filters.campaignIds]);
  const objectiveOptions = useMemo(() => {
    const values = new Set(Object.values(crm.catalog.campaign).map((c) => c.objective).filter((o): o is string => !!o));
    return [...values].map((value) => ({ value, label: objectiveLabel(value) })).sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [crm.catalog.campaign]);

  const labelOf = (options: MultiFilterOption[]) => (id: string) => options.find((o) => o.value === id)?.label ?? null;
  const chips = activeFilterChips(filters, {
    campaign: labelOf(campaignOptions),
    adset: labelOf(nameOptions(data, crm, "adset", [])),
    objective: (value) => objectiveLabel(value),
    money: (value) => money(value, currency, { narrow: true }),
  });
  const clearMenuFilters = (current: AdsTableFilters) => setFilters({ ...clearFilters(current), q: current.q, status: current.status });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/anuncios"
        filtersBreakpoint="wide"
        left={<SyncedPill label={data.syncedLabel} />}
        tabs={<LevelTabs level={level} onChange={setLevel} />}
        filters={
          <>
            <ExpandableSearch value={filters.q} onCommit={(q) => setFilters({ ...filters, q })} label="Buscar por nombre" placeholder="Buscar por nombre…" />
            <StatusMenu value={filters.status} counts={state.counts} onChange={(status) => setFilters({ ...filters, status })} />
            <AdsFiltersMenu
              filters={filters}
              onChange={setFilters}
              currency={currency}
              campaignOptions={campaignOptions}
              adsetOptions={adsetOptions}
              objectiveOptions={objectiveOptions}
            />
            <HeaderFilters accounts={data.accounts} adAccountId={adAccountId} period={period} onChange={nav.navigate} onApplyPeriod={nav.applyPeriod} />
          </>
        }
        right={
          <>
            <ColumnsMenu prefs={state.prefs} onChange={state.setPrefs} level={level} view={state.view} compact />
            {crm.canExport === true && <ExportCsvButton state={state} compact />}
            <RefreshButton refreshing={nav.pending} onRefresh={nav.refresh} />
          </>
        }
      />

      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-4 transition-opacity sm:p-6 ${nav.pending ? "opacity-60" : ""}`} aria-busy={nav.pending}>
        {liveError && <UniqueReachNotice error={liveError} />}
        <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Campañas, AdSets y anuncios">
          {(chips.length > 0 || crm.unmatchedCount > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <FilterChips chips={chips} onChange={setFilters} onClearAll={() => clearMenuFilters(filters)} />
              {crm.unmatchedCount > 0 && (
                <span className="ml-auto">
                  <UnmatchedLink count={crm.unmatchedCount} />
                </span>
              )}
            </div>
          )}
          <CrmLevelBody
            state={state}
            crm={crm}
            currency={currency}
            hrefOf={(id) => detailHref(level, id, adAccountId, period)}
            rowActions={rowActions}
            sort={filters.sort}
            onSort={(sort) => setFilters({ ...filters, sort })}
            emptyFiltered="Nada coincide con la búsqueda o los filtros en este período"
          />
        </section>
      </div>
    </div>
  );
}
