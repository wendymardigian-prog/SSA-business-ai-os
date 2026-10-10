"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart2, Activity } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DashboardSwitcher } from "./dashboard-switcher";
import type { DashboardOption } from "@/lib/dashboards/available";
import { DailyEvolutionChart } from "./ads/charts-lazy";
import { HeaderActions, HeaderFilters, SyncedPill } from "./ads/header-controls";
import { ComparisonCards } from "./ads/comparison-cards";
import { KpiRow, type KpiItem } from "./ads/kpi-row";
import { LEFT_OPTIONS, METRIC_LABELS, RIGHT_OPTIONS, type ChartMetric } from "./ads/formatters";
import { AdsAiPanel } from "./ads-ai-panel";
import type { PeriodPreset } from "@/lib/dashboards/period";
import {
  computeTotals,
  count,
  ctrTone,
  dailySeries,
  groupByObject,
  leadsTone,
  money,
  percent,
  statusLabel,
  videoRetention,
  videoTotals,
  type AdsRow,
} from "@/lib/dashboards/ads";
import { kpiDelta } from "@/lib/dashboards/ads-view";

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
  /** Alcance unico de cada anuncio (en vivo). Null si Meta no respondio. */
  adReach: Record<string, number> | null;
  /** "hoy 14:32": cuando escribio el sync por ultima vez. Armado en el servidor. */
  syncedLabel: string | null;
  /** Los dashboards que puede abrir quien esta mirando (B3). */
  dashboards: DashboardOption[];
}

type Tab = "campaign" | "adset" | "ad";

const TAB_LABELS: Record<Tab, string> = {
  campaign: "Campañas",
  adset: "Conjuntos",
  ad: "Anuncios",
};

const TONE_CLASS = {
  good: "text-emerald-600 dark:text-emerald-400",
  bad: "text-destructive font-semibold",
  neutral: "",
} as const;

const CARD = "rounded-xl border border-border bg-card p-3";
const SECTION_LABEL = "text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

export function AdsDashboard(props: AdsDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState<Tab>("campaign");
  const [aiOpen, setAiOpen] = useState(false);
  const [leftMetric, setLeftMetric] = useState<ChartMetric>("spend");
  const [rightMetric, setRightMetric] = useState<ChartMetric>("ctr");

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

  const grouped = useMemo(() => groupByObject(props.rows, tab), [props.rows, tab]);
  const retention = useMemo(() => videoRetention(videoTotals(accountRows)), [accountRows]);

  const chartData = useMemo(() => {
    const left = new Map(dailySeries(accountRows, leftMetric).map((p) => [p.bucket, p.value]));
    const right = new Map(dailySeries(accountRows, rightMetric).map((p) => [p.bucket, p.value]));
    return [...new Set([...left.keys(), ...right.keys()])]
      .sort()
      .map((bucket) => ({ date: bucket.slice(5), left: left.get(bucket) ?? null, right: right.get(bucket) ?? null }));
  }, [accountRows, leftMetric, rightMetric]);

  /** Cambiar la cuenta o el periodo viaja en la URL, como siempre. */
  function navigate(params: { cuenta?: string; periodo?: string }) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(params)) if (value) next.set(key, value);
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

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

  const money$ = (value: number | null) => money(value, props.currency, { narrow: true });

  const kpis: KpiItem[] = [
    { key: "spend", label: "Gasto total", value: money$(totals.spend), sub: "presupuesto usado", delta: kpiDelta(totals.spend, previousTotals.spend) },
    { key: "impressions", label: "Impresiones", value: count(totals.impressions), sub: "total de vistas", delta: kpiDelta(totals.impressions, previousTotals.impressions) },
    { key: "reach", label: "Alcance", value: count(totals.reach), sub: "cuentas únicas", delta: kpiDelta(totals.reach, previousTotals.reach) },
    { key: "frequency", label: "Frecuencia", value: totals.frequency?.toFixed(2) ?? "—", sub: "imp / persona", delta: null },
    { key: "clicks", label: "Clics", value: count(totals.clicks), sub: `CTR: ${percent(totals.ctr)}`, delta: kpiDelta(totals.clicks, previousTotals.clicks) },
    { key: "cpm", label: "CPM", value: money$(totals.cpm), sub: "por mil impr.", delta: kpiDelta(totals.cpm, previousTotals.cpm, { invert: true }) },
    { key: "cpc", label: "CPC", value: money$(totals.cpc), sub: "por clic", delta: kpiDelta(totals.cpc, previousTotals.cpc, { invert: true }) },
    { key: "leads", label: "Leads", value: count(totals.leads), sub: `CPL: ${money$(totals.cpl)}`, delta: kpiDelta(totals.leads, previousTotals.leads) },
  ];

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

        <section className={`${CARD} space-y-3`} aria-label="Evolución diaria">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-primary" aria-hidden /> Evolución diaria
            </h3>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-primary" aria-hidden />
                <span className="text-muted-foreground">Eje izq:</span>
                <select
                  value={leftMetric}
                  onChange={(e) => setLeftMetric(e.target.value as ChartMetric)}
                  className="cursor-pointer rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
                >
                  {LEFT_OPTIONS.map((key) => (
                    <option key={key} value={key}>
                      {METRIC_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5 rounded bg-[#ec4899]" aria-hidden />
                <span className="text-muted-foreground">Eje der:</span>
                <select
                  value={rightMetric}
                  onChange={(e) => setRightMetric(e.target.value as ChartMetric)}
                  className="cursor-pointer rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
                >
                  {RIGHT_OPTIONS.map((key) => (
                    <option key={key} value={key}>
                      {METRIC_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="h-72">
            {chartData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sin datos para el período seleccionado
              </div>
            ) : (
              <DailyEvolutionChart
                data={chartData}
                leftMetric={leftMetric}
                rightMetric={rightMetric}
                currency={props.currency}
              />
            )}
          </div>
        </section>

        <ComparisonCards variant="campaigns" rows={props.rows} currency={props.currency} adReach={props.adReach} />

        {retention.length > 0 && (
          <section className="mt-3">
            <h2 className="mb-2 text-sm font-semibold">Retencion de video</h2>
            <ul className="flex gap-3 rounded-xl border border-border p-3">
              {retention.map((point) => (
                <li key={point.label} className="flex-1 text-center">
                  <p className="text-xs text-muted-foreground">{point.label}</p>
                  <p className="text-base font-semibold tabular-nums">
                    {point.percent === null ? "—" : `${point.percent}%`}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-3">
          <div className="mb-2 flex gap-1" role="tablist" aria-label="Desglose">
            {(Object.keys(TAB_LABELS) as Tab[]).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={tab === option}
                onClick={() => setTab(option)}
                className={
                  tab === option
                    ? "rounded-md bg-accent px-2.5 py-1 text-xs font-medium"
                    : "rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/50"
                }
              >
                {TAB_LABELS[option]}
              </button>
            ))}
          </div>

          {grouped.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              No hay {TAB_LABELS[tab].toLowerCase()} con datos en este periodo.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="p-2 font-medium">Nombre</th>
                    <th scope="col" className="p-2 font-medium">Estado</th>
                    <th scope="col" className="p-2 text-right font-medium">Gasto</th>
                    <th scope="col" className="p-2 text-right font-medium" title="Impresiones ÷ alcance">Frec.</th>
                    <th scope="col" className="p-2 text-right font-medium">Clics</th>
                    <th scope="col" className="p-2 text-right font-medium" title="Clics ÷ impresiones × 100">CTR</th>
                    <th scope="col" className="p-2 text-right font-medium" title="Gasto ÷ clics">CPC</th>
                    <th scope="col" className="p-2 text-right font-medium">Leads</th>
                    <th scope="col" className="p-2 text-right font-medium" title="Gasto ÷ leads">CPL</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((group) => (
                    <tr key={group.objectId} className="border-b border-border last:border-0">
                      <td className="p-2">
                        <Link
                          href={detailHref(tab, group.objectId, props.adAccountId, props.period)}
                          className="hover:underline"
                        >
                          {group.objectName || group.objectId}
                        </Link>
                        {group.parentName && (
                          <span className="block text-[11px] text-muted-foreground">{group.parentName}</span>
                        )}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{statusLabel(group.status)}</td>
                      <td className="p-2 text-right tabular-nums">{money(group.spend, props.currency)}</td>
                      <td className="p-2 text-right tabular-nums">{group.frequency?.toFixed(2) ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums">{count(group.clicks)}</td>
                      <td className={`p-2 text-right tabular-nums ${TONE_CLASS[ctrTone(group.ctr)]}`}>
                        {percent(group.ctr)}
                      </td>
                      <td className="p-2 text-right tabular-nums">{money(group.cpc, props.currency)}</td>
                      <td className={`p-2 text-right tabular-nums ${TONE_CLASS[leadsTone(group.leads)]}`}>
                        {count(group.leads)}
                      </td>
                      <td className="p-2 text-right tabular-nums">{money(group.cpl, props.currency)}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/50 font-medium">
                    <td className="p-2">Total</td>
                    <td className="p-2" />
                    <td className="p-2 text-right tabular-nums">{money(totals.spend, props.currency)}</td>
                    <td className="p-2 text-right tabular-nums">{totals.frequency?.toFixed(2) ?? "—"}</td>
                    <td className="p-2 text-right tabular-nums">{count(totals.clicks)}</td>
                    <td className="p-2 text-right tabular-nums">{percent(totals.ctr)}</td>
                    <td className="p-2 text-right tabular-nums">{money(totals.cpc, props.currency)}</td>
                    <td className="p-2 text-right tabular-nums">{count(totals.leads)}</td>
                    <td className="p-2 text-right tabular-nums">{money(totals.cpl, props.currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {aiOpen && (
        <AdsAiPanel
          period={props.period}
          adAccountId={props.adAccountId}
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  );
}

/** La cuenta elegida y el periodo viajan a todos los niveles. */
function detailHref(tab: Tab, objectId: string, adAccountId: string, period: PeriodPreset): string {
  const segment = tab === "campaign" ? "campaigns" : tab === "adset" ? "adsets" : "ads";
  return `/dashboard/dashboards/ads/${segment}/${objectId}?cuenta=${adAccountId}&periodo=${period}`;
}
