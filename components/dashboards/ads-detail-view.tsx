"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { money, objectiveLabel, percent, ratio, type AdsRow, type AdsTotals } from "@/lib/dashboards/ads";
import {
  breadcrumbs,
  budgetProgress,
  rowsFor,
  siblingAds,
  type DetailLevel,
  type DetailView,
} from "@/lib/dashboards/ads-detail";
import type { PeriodPreset } from "@/lib/dashboards/period";
import type { Rankings } from "@/lib/dashboards/ads-view";
import type { BreakdownRow } from "@/lib/meta/live";
import { AudienceCard, HourlyCard } from "./ads/audience-card";
import { ComparisonCards } from "./ads/comparison-cards";
import { DailyTableCard } from "./ads/daily-table";
import { EvolutionCard } from "./ads/evolution-card";
import { FunnelCard } from "./ads/funnel-viz";
import { HeaderFilters, RefreshButton } from "./ads/header-controls";
import { HierarchyCard, type Level } from "./ads/hierarchy-tables";
import { ActionsCard, DeviceCard, PlacementCard, RankingsCard, VideoCard, type Live } from "./ads/insight-cards";
import { buildKpiItems } from "./ads/kpi-items";
import { KpiRow } from "./ads/kpi-row";
import { useAdsNavigation } from "./ads/use-ads-navigation";

/**
 * El detalle de una campaña, un conjunto o un anuncio (F57).
 *
 * Una plantilla para los tres, con el mismo orden que el dashboard principal:
 * cambian el encabezado, la fila de presupuesto o creativo, y que tarjetas
 * hay en la grilla de cuatro (en un anuncio, Rankings reemplaza a Dispositivo).
 * Tres pantallas distintas para la misma informacion serian tres lugares donde
 * arreglar el mismo error.
 *
 * **Un detalle muestra SOLO lo suyo**: las filas, el video, las acciones y los
 * desgloses en vivo son los de este objeto y los de sus hijos.
 */

const SEGMENT: Record<DetailLevel, string> = { campaign: "campaigns", adset: "adsets", ad: "ads" };

const CREATIVE_TYPE_LABELS: Record<string, string> = {
  VIDEO: "Video",
  PHOTO: "Imagen",
  SHARE: "Carrusel / Link",
  STATUS: "Texto",
};

const STATUS_PILL = {
  ACTIVE: "border-green-500/30 bg-green-500/10 text-green-600",
  PAUSED: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
} as const;

const CHILD_LEVELS: Record<DetailLevel, Level[]> = {
  campaign: ["adset", "ad"],
  adset: ["ad"],
  ad: [],
};

export interface AdsDetailViewProps {
  level: DetailLevel;
  detail: DetailView;
  allRows: AdsRow[];
  previousTotals: AdsTotals | null;
  rankings: Rankings | null;
  adAccountId: string;
  currency: string | null;
  period: PeriodPreset;
  days: number;
  syncedLabel: string | null;
  reach: { adset: Record<string, number> | null; ad: Record<string, number> | null };
  live: {
    placement: Live<BreakdownRow[]>;
    device: Live<BreakdownRow[]>;
    audience: Live<BreakdownRow[]>;
    hourly: Live<BreakdownRow[]>;
  };
  /** Lo que se pide en vivo: objetivo, presupuesto, creativo. */
  meta: {
    objective: string | null;
    dailyBudget: number | null;
    lifetimeBudget: number | null;
    creative: {
      title: string | null;
      body: string | null;
      thumbnailUrl: string | null;
      cta: string | null;
      objectType: string | null;
    } | null;
    error: string | null;
  };
}

export function AdsDetailView({
  level,
  detail,
  allRows,
  previousTotals,
  rankings,
  adAccountId,
  currency,
  period,
  days,
  reach,
  live,
  meta,
}: AdsDetailViewProps) {
  const router = useRouter();
  const { pending, navigate, refresh } = useAdsNavigation();

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
                  : (allRows.find((r) => r.level === "campaign" && r.objectId === detail.campaignId)?.objectName ?? null),
            }
          : null,
        adset:
          level === "adset"
            ? { id: detail.objectId, name: detail.objectName }
            : level === "ad" && detail.adsetId
              ? {
                  id: detail.adsetId,
                  name: allRows.find((r) => r.level === "adset" && r.objectId === detail.adsetId)?.objectName ?? null,
                }
              : null,
        ad: level === "ad" ? { name: detail.objectName } : null,
        adAccountId,
        period,
      }),
    [level, detail, allRows, adAccountId, period],
  );

  // A donde vuelve la flecha: la ultima miga que es un link.
  const parent = [...crumbs].reverse().find((c) => c.href);
  const parentHref = parent?.href ?? `/dashboard/dashboards/ads?cuenta=${adAccountId}&periodo=${period}`;
  const parentLabel = parent?.label ?? "Meta Ads";

  const budget = budgetProgress({
    dailyBudget: meta.dailyBudget,
    lifetimeBudget: meta.lifetimeBudget,
    spent: detail.totals.spend,
    days,
  });

  const siblings = level === "ad" ? siblingAds(allRows, { campaignId: detail.campaignId, currentAdId: detail.objectId }) : [];

  /** Lo suyo y lo de sus hijos: lo unico que se muestra en este detalle. */
  const scoped = useMemo(() => rowsFor(allRows, { level, objectId: detail.objectId }), [allRows, level, detail.objectId]);
  /** Las acciones y el periodo son del propio objeto. */
  const own = detail.daily;
  /**
   * El video de una campaña o un conjunto sale de sus anuncios: las filas de
   * esos niveles no tenian video guardado hasta la ultima version del sync, y
   * las vistas y los porcentajes SI se pueden sumar entre anuncios.
   */
  const videoRows = useMemo(
    () => (level === "ad" ? own : scoped.filter((r) => r.level === "ad")),
    [level, own, scoped],
  );

  const outbound = detail.totals.outboundClicks;
  const outboundCtr = ratio(outbound, detail.totals.impressions);
  const kpis = buildKpiItems({
    totals: detail.totals,
    previous: previousTotals,
    currency,
    clicksSub:
      level === "ad" && outbound
        ? `Salientes: ${outbound.toLocaleString("es-AR")} (${percent(outboundCtr === null ? null : Number((outboundCtr * 100).toFixed(2)))})`
        : undefined,
  });

  const status = detail.status;
  const statusClass =
    status && status in STATUS_PILL ? STATUS_PILL[status as keyof typeof STATUS_PILL] : "border-border bg-muted text-muted-foreground";
  const creativeType = meta.creative?.objectType ? (CREATIVE_TYPE_LABELS[meta.creative.objectType] ?? meta.creative.objectType) : null;

  const m = (value: number | null) => money(value, currency, { narrow: true });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route={`/dashboard/dashboards/ads/${SEGMENT[level]}/[id]`}
        title={detail.objectName || detail.objectId}
        backHref={
          <Link
            href={parentHref}
            aria-label={`Volver a ${parentLabel}`}
            title={`Volver a ${parentLabel}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
        }
        left={
          <>
            {status && (
              <span className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${statusClass}`}>
                {STATUS_LABEL[status] ?? status}
              </span>
            )}
          </>
        }
        filters={<HeaderFilters accounts={[]} adAccountId={adAccountId} period={period} onChange={navigate} />}
        right={
          <div className="flex items-center gap-2">
            <RefreshButton refreshing={pending} onRefresh={refresh} />
          </div>
        }
      />

      <div
        className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-4 transition-opacity sm:p-6 ${pending ? "opacity-60" : ""}`}
        aria-busy={pending}
      >
        {/*
          Las migas van en el contenido y no en la barra: en el celular la barra
          no tiene lugar, y desde cualquier detalle tiene que poder volverse al
          dashboard general (el primer paso, "Meta Ads") y a cada nivel de arriba.
        */}
        <nav aria-label="Migas de pan" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="max-w-[12rem] truncate rounded px-1 py-0.5 font-medium text-primary hover:bg-accent hover:underline sm:max-w-[20rem]"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current="page" className="max-w-[14rem] truncate px-1 py-0.5 text-foreground sm:max-w-[24rem]">
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold leading-tight text-foreground">{detail.objectName || detail.objectId}</h2>
          {level !== "ad" && meta.objective && (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {objectiveLabel(meta.objective)}
            </span>
          )}
          {level === "ad" && creativeType && (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {creativeType}
            </span>
          )}
        </div>

        {siblings.length > 0 && (
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Otro anuncio de la campaña
            <select
              aria-label="Otro anuncio de la campaña"
              value={detail.objectId}
              onChange={(e) =>
                router.push(`/dashboard/dashboards/ads/ads/${e.target.value}?cuenta=${adAccountId}&periodo=${period}`)
              }
              className="h-8 min-w-0 max-w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground"
            >
              <option value={detail.objectId}>{detail.objectName || detail.objectId}</option>
              {siblings.map((sibling) => (
                <option key={sibling.id} value={sibling.id}>
                  {sibling.name || sibling.id}
                </option>
              ))}
            </select>
          </label>
        )}

        {meta.error && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            No pude leer el objetivo ni el presupuesto: {meta.error}. Las metricas guardadas se muestran igual.
          </p>
        )}

        {level === "ad" && meta.creative && (
          <section className="flex gap-3 rounded-xl border border-border bg-card p-3" aria-label="El creativo">
            {meta.creative.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={meta.creative.thumbnailUrl} alt="" className="h-24 w-24 shrink-0 rounded object-cover" />
            )}
            <div className="min-w-0 text-sm">
              {meta.creative.title && <p className="font-medium text-foreground">{meta.creative.title}</p>}
              {meta.creative.body && <p className="mt-1 line-clamp-4 text-muted-foreground">{meta.creative.body}</p>}
              {meta.creative.cta && (
                <p className="mt-2 inline-block rounded bg-muted px-2 py-0.5 text-xs">{meta.creative.cta}</p>
              )}
            </div>
          </section>
        )}

        {budget && (
          <section className="flex items-center gap-3 rounded-xl border border-border bg-card p-2" aria-label="Presupuesto">
            <p className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {budget.kind === "daily" ? "Presup. diario" : "Presup. total"}
            </p>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, budget.percent ?? 0)}%` }} />
            </div>
            <p className="shrink-0 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{m(budget.spent)}</span>
              {budget.kind === "daily" ? " por día de " : " / "}
              {m(budget.amount)}
              {budget.remaining !== null && <span className="hidden md:inline"> · resta {m(budget.remaining)}</span>}
            </p>
          </section>
        )}

        <section className="space-y-2" aria-label="Resumen">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Resumen</p>
          <KpiRow items={kpis} />
        </section>

        <EvolutionCard rows={own} currency={currency} />

        {level !== "ad" && <ComparisonCards variant="ads" rows={scoped} currency={currency} adReach={reach.ad} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionsCard rows={own} />
          <PlacementCard result={live.placement} currency={currency} />
          {level === "ad" ? <RankingsCard rankings={rankings} /> : <DeviceCard result={live.device} currency={currency} />}
          <VideoCard rows={videoRows} />
        </div>

        <AudienceCard result={live.audience} />
        <HourlyCard result={live.hourly} currency={currency} />
        <FunnelCard totals={detail.totals} currency={currency} />

        {CHILD_LEVELS[level].length > 0 && (
          <HierarchyCard
            levels={CHILD_LEVELS[level]}
            rows={scoped}
            totals={detail.totals}
            uniqueReach={{ campaign: null, adset: reach.adset, ad: reach.ad }}
            currency={currency}
            adAccountId={adAccountId}
            period={period}
          />
        )}

        <DailyTableCard rows={own} totals={detail.totals} currency={currency} />
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  DELETED: "Eliminada",
  ARCHIVED: "Archivada",
  CAMPAIGN_PAUSED: "Campaña pausada",
  ADSET_PAUSED: "Conjunto pausado",
  WITH_ISSUES: "Con problemas",
  PENDING_REVIEW: "En revisión",
  DISAPPROVED: "Desaprobado",
  IN_PROCESS: "En proceso",
};
