"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { DualAxisChart, type ChartSeries } from "./charts";
import {
  count,
  ctrTone,
  dailySeries,
  funnel,
  money,
  objectiveLabel,
  percent,
  statusLabel,
  videoRetention,
  videoTotals,
  type AdsRow,
  type GroupedRow,
} from "@/lib/dashboards/ads";
import {
  breadcrumbs,
  budgetProgress,
  rankingLabel,
  siblingAds,
  type DetailLevel,
  type DetailView,
} from "@/lib/dashboards/ads-detail";
import type { PeriodPreset } from "@/lib/dashboards/period";

/**
 * El detalle de una campaña, un conjunto o un anuncio (F57).
 *
 * Una plantilla para los tres: cambian las migas, el presupuesto y las
 * tablas de abajo, pero las cifras, la evolucion y el embudo son los
 * mismos. Tres pantallas distintas para la misma informacion serian tres
 * lugares donde arreglar el mismo error.
 */

const TONE_CLASS = {
  good: "text-emerald-600 dark:text-emerald-400",
  bad: "text-destructive font-semibold",
  neutral: "",
} as const;

export function AdsDetailView({
  level,
  detail,
  allRows,
  adAccountId,
  currency,
  period,
  days,
  meta,
}: {
  level: DetailLevel;
  detail: DetailView;
  allRows: AdsRow[];
  adAccountId: string;
  currency: string | null;
  period: PeriodPreset;
  days: number;
  /** Lo que se pide en vivo: objetivo, presupuesto, creativo. */
  meta: {
    objective: string | null;
    dailyBudget: number | null;
    lifetimeBudget: number | null;
    creative: { title: string | null; body: string | null; thumbnailUrl: string | null; cta: string | null } | null;
    error: string | null;
  };
}) {
  const router = useRouter();
  const [barMetric, setBarMetric] = useState<"spend" | "impressions" | "clicks" | "leads">("spend");

  const crumbs = useMemo(
    () =>
      breadcrumbs({
        level,
        campaign: detail.campaignId
          ? {
              id: detail.campaignId,
              name:
                level === "campaign"
                  ? detail.objectName
                  : (allRows.find((r) => r.level === "campaign" && r.objectId === detail.campaignId)
                      ?.objectName ?? null),
            }
          : null,
        adset:
          level === "adset"
            ? { id: detail.objectId, name: detail.objectName }
            : level === "ad" && detail.adsetId
              ? {
                  id: detail.adsetId,
                  name:
                    allRows.find((r) => r.level === "adset" && r.objectId === detail.adsetId)
                      ?.objectName ?? null,
                }
              : null,
        ad: level === "ad" ? { name: detail.objectName } : null,
        adAccountId,
        period,
      }),
    [level, detail, allRows, adAccountId, period],
  );

  const budget = budgetProgress({
    dailyBudget: meta.dailyBudget,
    lifetimeBudget: meta.lifetimeBudget,
    spent: detail.totals.spend,
    days,
  });

  const siblings = level === "ad" ? siblingAds(allRows, { campaignId: detail.campaignId, currentAdId: detail.objectId }) : [];

  const bars: ChartSeries[] = [
    {
      key: barMetric,
      label: { spend: "Gasto", impressions: "Impresiones", clicks: "Clics", leads: "Leads" }[barMetric],
      color: "var(--primary)",
      points: dailySeries(detail.daily, barMetric),
    },
  ];

  const lines: ChartSeries[] = [
    { key: "ctr", label: "CTR", color: "#f59e0b", points: dailySeries(detail.daily, "ctr") },
  ];

  const retention = videoRetention(videoTotals(detail.daily));

  const rankings = detail.daily[0];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route={`/dashboard/dashboards/ads/${level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : "ads"}/[id]`}
        title={detail.objectName || detail.objectId}
        left={
          <nav aria-label="Migas de pan" className="ml-2 hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <span aria-hidden>›</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        }
        right={
          siblings.length > 0 ? (
            <select
              aria-label="Otro anuncio de la campaña"
              value={detail.objectId}
              onChange={(e) =>
                router.push(
                  `/dashboard/dashboards/ads/ads/${e.target.value}?cuenta=${adAccountId}&periodo=${period}`,
                )
              }
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              <option value={detail.objectId}>{detail.objectName || detail.objectId}</option>
              {siblings.map((sibling) => (
                <option key={sibling.id} value={sibling.id}>
                  {sibling.name || sibling.id}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{statusLabel(detail.status)}</span>
          {meta.objective && (
            <span className="text-muted-foreground">{objectiveLabel(meta.objective)}</span>
          )}
        </div>

        {meta.error && (
          <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            No pude leer el objetivo ni el presupuesto: {meta.error}. Las metricas guardadas se
            muestran igual.
          </p>
        )}

        {budget && (
          <section className="mb-6 rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">
              Presupuesto {budget.kind === "daily" ? "diario" : "total"}
            </p>
            <p className="mt-1 text-sm">
              <span className="font-semibold tabular-nums">{money(budget.spent, currency)}</span>
              {budget.kind === "daily" ? " por dia en promedio" : " gastados"} de{" "}
              {money(budget.amount, currency)}
              {budget.remaining !== null && ` · quedan ${money(budget.remaining, currency)}`}
            </p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${Math.min(100, budget.percent ?? 0)}%` }}
              />
            </div>
          </section>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Gasto" value={money(detail.totals.spend, currency)} />
          <Kpi label="Impresiones" value={count(detail.totals.impressions)} />
          <Kpi label="Alcance" value={count(detail.totals.reach)} />
          <Kpi label="Frecuencia" value={detail.totals.frequency?.toFixed(2) ?? "—"} />
          <Kpi label={level === "ad" ? "Clics salientes" : "Clics"} value={count(level === "ad" ? detail.totals.outboundClicks ?? detail.totals.clicks : detail.totals.clicks)} />
          <Kpi label="CTR" value={percent(detail.totals.ctr)} tone={ctrTone(detail.totals.ctr)} />
          <Kpi label="CPC" value={money(detail.totals.cpc, currency)} />
          <Kpi label="Leads" value={count(detail.totals.leads)} hint={detail.totals.cpl === null ? "sin CPL" : `${money(detail.totals.cpl, currency)} por lead`} />
        </div>

        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Evolucion diaria</h2>
            <select
              aria-label="Metrica"
              value={barMetric}
              onChange={(e) => setBarMetric(e.target.value as typeof barMetric)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="spend">Gasto</option>
              <option value="impressions">Impresiones</option>
              <option value="clicks">Clics</option>
              <option value="leads">Leads</option>
            </select>
          </div>
          <DualAxisChart bars={bars} lines={lines} />
        </section>

        {level === "ad" && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold">Rankings</h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Ranking label="Calidad" value={rankings?.qualityRanking ?? null} />
              <Ranking label="Engagement" value={rankings?.engagementRanking ?? null} />
              <Ranking label="Conversion" value={rankings?.conversionRanking ?? null} />
            </ul>
          </section>
        )}

        {level === "ad" && meta.creative && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold">El creativo</h2>
            <div className="flex gap-3 rounded-xl border border-border p-3">
              {meta.creative.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={meta.creative.thumbnailUrl} alt="" className="h-24 w-24 rounded object-cover" />
              )}
              <div className="min-w-0 text-sm">
                {meta.creative.title && <p className="font-medium">{meta.creative.title}</p>}
                {meta.creative.body && <p className="mt-1 text-muted-foreground">{meta.creative.body}</p>}
                {meta.creative.cta && (
                  <p className="mt-2 inline-block rounded bg-muted px-2 py-0.5 text-xs">
                    {meta.creative.cta}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

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
          <h2 className="mb-2 text-sm font-semibold">Embudo</h2>
          <ul className="divide-y rounded-xl border border-border">
            {funnel(detail.totals).map((step) => (
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

        {detail.children.length > 0 && (
          <ChildTable
            title={level === "campaign" ? "Sus conjuntos" : "Sus anuncios"}
            rows={detail.children}
            currency={currency}
            hrefOf={(id) =>
              `/dashboard/dashboards/ads/${level === "campaign" ? "adsets" : "ads"}/${id}?cuenta=${adAccountId}&periodo=${period}`
            }
          />
        )}

        {level === "campaign" && detail.ads.length > 0 && (
          <ChildTable
            title="Sus anuncios"
            rows={detail.ads}
            currency={currency}
            hrefOf={(id) => `/dashboard/dashboards/ads/ads/${id}?cuenta=${adAccountId}&periodo=${period}`}
          />
        )}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONE_CLASS;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${TONE_CLASS[tone]}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Ranking({ label, value }: { label: string; value: string | null }) {
  return (
    <li className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{rankingLabel(value)}</p>
    </li>
  );
}

function ChildTable({
  title,
  rows,
  currency,
  hrefOf,
}: {
  title: string;
  rows: GroupedRow[];
  currency: string | null;
  hrefOf: (id: string) => string;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="p-2 font-medium">Nombre</th>
              <th scope="col" className="p-2 text-right font-medium">Gasto</th>
              <th scope="col" className="p-2 text-right font-medium">Clics</th>
              <th scope="col" className="p-2 text-right font-medium">CTR</th>
              <th scope="col" className="p-2 text-right font-medium">Leads</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.objectId} className="border-b border-border last:border-0">
                <td className="p-2">
                  <Link href={hrefOf(row.objectId)} className="hover:underline">
                    {row.objectName || row.objectId}
                  </Link>
                </td>
                <td className="p-2 text-right tabular-nums">{money(row.spend, currency)}</td>
                <td className="p-2 text-right tabular-nums">{count(row.clicks)}</td>
                <td className={`p-2 text-right tabular-nums ${TONE_CLASS[ctrTone(row.ctr)]}`}>
                  {percent(row.ctr)}
                </td>
                <td className="p-2 text-right tabular-nums">{count(row.leads)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
