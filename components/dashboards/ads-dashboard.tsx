"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DashboardSwitcher } from "./dashboard-switcher";
import type { DashboardOption } from "@/lib/dashboards/available";
import { DualAxisChart, type ChartSeries } from "./charts";
import { AdsAiPanel } from "./ads-ai-panel";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/dashboards/period";
import {
  computeTotals,
  count,
  ctrTone,
  dailySeries,
  funnel,
  groupByObject,
  leadsTone,
  money,
  percent,
  statusLabel,
  videoRetention,
  videoTotals,
  type AdsRow,
} from "@/lib/dashboards/ads";

/**
 * El dashboard de Meta Ads (F56).
 *
 * Ocho cifras arriba, la evolucion diaria con dos ejes, el desglose por
 * campaña, conjunto y anuncio, y el embudo. Todas las formulas vienen de
 * `lib/dashboards/ads.ts`, que es puro y esta probado.
 *
 * Los colores del CTR y de los leads en cero no son decoracion: son las dos
 * cosas que se miran para decidir si una campaña sigue o se apaga.
 */

export interface AdsDashboardProps {
  rows: AdsRow[];
  previousRows: AdsRow[];
  accounts: Array<{ id: string; name: string | null; currency: string | null }>;
  adAccountId: string;
  currency: string | null;
  period: PeriodPreset;
  /** El alcance unico del periodo, de la consulta en vivo (F58). */
  uniqueReach: number | null;
  liveError: string | null;
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

export function AdsDashboard(props: AdsDashboardProps) {
  const [tab, setTab] = useState<Tab>("campaign");
  const [aiOpen, setAiOpen] = useState(false);
  const [barMetric, setBarMetric] = useState<"spend" | "impressions" | "clicks" | "reach" | "leads">("spend");
  const [lineMetric, setLineMetric] = useState<"ctr" | "cpc" | "cpm" | "leads">("ctr");

  const accountRows = useMemo(() => props.rows.filter((r) => r.level === "account"), [props.rows]);

  const totals = useMemo(
    () => computeTotals(accountRows, props.uniqueReach),
    [accountRows, props.uniqueReach],
  );

  const previousTotals = useMemo(
    () => computeTotals(props.previousRows.filter((r) => r.level === "account")),
    [props.previousRows],
  );

  const grouped = useMemo(() => groupByObject(props.rows, tab), [props.rows, tab]);
  const steps = useMemo(() => funnel(totals), [totals]);
  const retention = useMemo(() => videoRetention(videoTotals(accountRows)), [accountRows]);

  if (props.accounts.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader route="/dashboard/dashboards/ads" left={<DashboardSwitcher options={props.dashboards} />} />
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            Todavia no hay ninguna cuenta publicitaria sincronizando.{" "}
            <Link href="/dashboard/settings/integrations" className="text-primary underline underline-offset-2">
              Conecta Meta y elegí cuáles
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  const bars: ChartSeries[] = [
    {
      key: barMetric,
      label: METRIC_LABELS[barMetric],
      color: "var(--primary)",
      points: dailySeries(accountRows, barMetric),
    },
  ];

  const lines: ChartSeries[] = [
    {
      key: lineMetric,
      label: METRIC_LABELS[lineMetric],
      color: "#f59e0b",
      points: dailySeries(accountRows, lineMetric),
    },
  ];

  const kpis = [
    { key: "spend", label: "Gasto total", value: money(totals.spend, props.currency), prev: previousTotals.spend, now: totals.spend },
    { key: "impressions", label: "Impresiones", value: count(totals.impressions), prev: previousTotals.impressions, now: totals.impressions },
    { key: "reach", label: "Alcance", value: count(totals.reach), prev: previousTotals.reach, now: totals.reach },
    { key: "frequency", label: "Frecuencia", value: totals.frequency?.toFixed(2) ?? "—", prev: previousTotals.frequency, now: totals.frequency },
    { key: "clicks", label: `Clics (${percent(totals.ctr)} CTR)`, value: count(totals.clicks), prev: previousTotals.clicks, now: totals.clicks },
    { key: "cpm", label: "CPM", value: money(totals.cpm, props.currency), prev: previousTotals.cpm, now: totals.cpm },
    { key: "cpc", label: "CPC", value: money(totals.cpc, props.currency), prev: previousTotals.cpc, now: totals.cpc },
    {
      key: "leads",
      label: `Leads (${totals.cpl === null ? "—" : money(totals.cpl, props.currency)} CPL)`,
      value: count(totals.leads),
      prev: previousTotals.leads,
      now: totals.leads,
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/dashboards/ads"
        left={<DashboardSwitcher options={props.dashboards} />}
        right={
          <div className="flex items-center gap-2">
            {props.accounts.length > 1 && (
              <select
                aria-label="Cuenta publicitaria"
                value={props.adAccountId}
                onChange={(e) => go({ cuenta: e.target.value })}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {props.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name || account.id}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Periodo"
              value={props.period}
              onChange={(e) => go({ periodo: e.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {PERIOD_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {PERIOD_LABELS[preset]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Analizar con IA
            </button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {props.liveError && (
          <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            El alcance unico del periodo no se pudo leer: {props.liveError}. Lo que se muestra es la
            suma de los dias, que cuenta dos veces a quien vio el anuncio en dos dias distintos.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.key} className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{kpi.value}</p>
              <Delta now={kpi.now} previous={kpi.prev} />
            </div>
          ))}
        </div>

        <section className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Evolucion diaria</h2>
            <div className="flex gap-2">
              <select
                aria-label="Barras"
                value={barMetric}
                onChange={(e) => setBarMetric(e.target.value as typeof barMetric)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {(["spend", "impressions", "clicks", "reach", "leads"] as const).map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABELS[m]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Linea"
                value={lineMetric}
                onChange={(e) => setLineMetric(e.target.value as typeof lineMetric)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {(["ctr", "cpc", "cpm", "leads"] as const).map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DualAxisChart
            bars={bars}
            lines={lines}
            emptyMessage="Todavia no hay datos de esta cuenta en este periodo."
          />
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Embudo</h2>
          <ul className="divide-y rounded-xl border border-border">
            {steps.map((step) => (
              <li key={step.label} className="flex items-baseline justify-between p-2 text-sm">
                <span>{step.label}</span>
                <span className="tabular-nums">
                  {count(step.value)}
                  {step.conversion !== null && (
                    <span className="ml-2 text-xs text-muted-foreground">{step.conversion}%</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {retention.length > 0 && (
          <section className="mt-6">
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

        <section className="mt-6">
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

const METRIC_LABELS: Record<string, string> = {
  spend: "Gasto",
  impressions: "Impresiones",
  clicks: "Clics",
  reach: "Alcance",
  leads: "Leads",
  ctr: "CTR",
  cpc: "CPC",
  cpm: "CPM",
};

function Delta({ now, previous }: { now: number | null; previous: number | null }) {
  if (now === null || previous === null || previous === 0) return null;
  const change = Number((((now - previous) / previous) * 100).toFixed(1));
  return (
    <p className="text-xs text-muted-foreground">
      {change > 0 ? "▲" : change < 0 ? "▼" : "="} {Math.abs(change)}% vs. periodo anterior
    </p>
  );
}

/** La cuenta elegida y el periodo viajan a todos los niveles. */
function detailHref(tab: Tab, objectId: string, adAccountId: string, period: PeriodPreset): string {
  const segment = tab === "campaign" ? "campaigns" : tab === "adset" ? "adsets" : "ads";
  return `/dashboard/dashboards/ads/${segment}/${objectId}?cuenta=${adAccountId}&periodo=${period}`;
}

function go(params: Record<string, string>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  window.location.href = url.toString();
}
