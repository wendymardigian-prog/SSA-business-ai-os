/**
 * Lo que las tres pantallas de detalle hacen igual (F57).
 *
 * Las tres leen lo mismo: la cuenta elegida, el periodo, las filas y los
 * metadatos en vivo. Repetirlo tres veces serian tres lugares donde
 * arreglar el mismo error.
 */

import { notFound } from "next/navigation";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { previousPeriod, isPeriodPreset, resolvePeriod, type PeriodPreset } from "@/lib/dashboards/period";
import { DEFAULT_PERIOD } from "@/lib/dashboards/url-state";
import { parseMetaConfig, resolveSyncedAccount, syncedAccounts } from "@/lib/meta/accounts";
import { getMetaToken } from "@/lib/meta/token";
import {
  fetchBreakdown,
  fetchObjectMeta,
  fetchReachByLevel,
  fetchUniqueReach,
  type BreakdownKind,
  type BreakdownRow,
  type LiveResult,
} from "@/lib/meta/live";
import { loadAdsInsights } from "./ads-load";
import { buildDetail, ownRows, type DetailLevel, type DetailView } from "./ads-detail";
import { lastSyncedAt, syncedLabel, type Rankings, latestRankings } from "./ads-view";
import { computeTotals, type AdsRow, type AdsTotals } from "./ads";
import { daysBetween } from "@/lib/metrics/rules";
import { isoToDateInput } from "@/lib/dates";
import { resolveViewerTimezone } from "@/lib/user-timezone";

type Live<T> = LiveResult<T> | null;

export interface DetailPageData {
  detail: DetailView;
  /** Las filas del periodo de toda la cuenta (migas, hermanos). */
  allRows: AdsRow[];
  /** Los totales del periodo anterior, para la variacion. Null si no se pueden comparar. */
  previousTotals: AdsTotals | null;
  /** El ultimo ranking de Meta de este anuncio. */
  rankings: Rankings | null;
  adAccountId: string;
  currency: string | null;
  period: PeriodPreset;
  days: number;
  /** "hoy 14:32": la ultima escritura del sync. */
  syncedLabel: string | null;
  /** Alcance unico de los hijos (conjuntos y anuncios de este objeto). */
  reach: { adset: Record<string, number> | null; ad: Record<string, number> | null };
  /** Los desgloses en vivo de ESTE objeto, cada uno por su cuenta. */
  live: {
    placement: Live<BreakdownRow[]>;
    device: Live<BreakdownRow[]>;
    audience: Live<BreakdownRow[]>;
    hourly: Live<BreakdownRow[]>;
  };
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

export async function loadDetailPage(params: {
  level: DetailLevel;
  objectId: string;
  searchParams: Record<string, string | string[] | undefined>;
}): Promise<DetailPageData> {
  const { workspace, supabase } = await requireWorkspaceAdmin();
  const sp = params.searchParams;

  const periodParam = typeof sp.periodo === "string" ? sp.periodo : null;
  const period: PeriodPreset =
    periodParam && isPeriodPreset(periodParam) ? periodParam : DEFAULT_PERIOD;

  const { data: configRow } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspace.id)
    .eq("type", "meta")
    .eq("provider", "meta")
    .maybeSingle();

  const config = parseMetaConfig(configRow?.config);
  const resolved = resolveSyncedAccount(
    config.ad_accounts,
    typeof sp.cuenta === "string" ? sp.cuenta : undefined,
  );
  if (!resolved.ok) notFound();

  const adAccountId = resolved.adAccountId;
  const account = syncedAccounts(config.ad_accounts).find((a) => a.ad_account_id === adAccountId);

  const now = new Date();
  const timeZone = await resolveViewerTimezone(workspace.timezone);
  const range = resolvePeriod(period, now, timeZone);
  const before = previousPeriod(range, now);
  const token = await getMetaToken(supabase, workspace.id);

  const sinceOf = (p: { from: string | null }) => (p.from ? isoToDateInput(p.from, timeZone) : null);
  const untilOf = (p: { to: string | null }) => isoToDateInput(p.to ?? now.toISOString(), timeZone);

  const objectId = params.objectId;
  const level = params.level;
  const live = <T>(run: (since: string, until: string) => Promise<LiveResult<T>>): Promise<Live<T>> =>
    token && range.from ? run(sinceOf(range) as string, untilOf(range)) : Promise.resolve(null);
  const breakdownOf = (breakdown: BreakdownKind) =>
    live((since, until) => fetchBreakdown({ token: token as string, adAccountId, objectId, breakdown, since, until }));
  const childReach = (childLevel: "adset" | "ad") =>
    live((since, until) => fetchReachByLevel({ token: token as string, adAccountId, objectId, level: childLevel, since, until }));

  const [allRows, previousRows, reachNow, reachBefore, objectMeta, adsetReach, adReach, placement, device, audience, hourly] =
    await Promise.all([
      loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: range, timeZone }),
      loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: before, timeZone }),
      live((since, until) => fetchUniqueReach({ token: token as string, adAccountId, objectId, since, until })),
      token && before.from
        ? fetchUniqueReach({ token, adAccountId, objectId, since: sinceOf(before) as string, until: untilOf(before) })
        : Promise.resolve(null),
      token ? fetchObjectMeta({ token, adAccountId, objectId, level }) : Promise.resolve(null),
      level === "campaign" ? childReach("adset") : Promise.resolve(null),
      level === "ad" ? Promise.resolve(null) : childReach("ad"),
      breakdownOf("publisher_platform,platform_position"),
      // El anuncio no muestra dispositivo en la referencia: no se pide.
      level === "ad" ? Promise.resolve(null) : breakdownOf("device_platform"),
      breakdownOf("age,gender"),
      breakdownOf("hourly_stats_aggregated_by_advertiser_time_zone"),
    ]);

  const detail = buildDetail({
    rows: allRows,
    level,
    objectId,
    uniqueReach: reachNow?.ok ? reachNow.data.reach : null,
  });

  // Sin filas propias no hay nada que mostrar: el objeto no tuvo actividad
  // en este periodo, o es de otra cuenta.
  if (!detail) notFound();

  const previousOwn = ownRows(previousRows, { level, objectId });
  let previousTotals: AdsTotals | null =
    previousOwn.length > 0 ? computeTotals(previousOwn, reachBefore?.ok ? reachBefore.data.reach : null) : null;

  // El alcance solo se compara si los dos salen de la misma fuente (los dos
  // unicos, o los dos sumados por dia). Un unico contra uno sumado
  // inventaria una variacion: sin comparacion, el alcance queda sin flecha.
  if (previousTotals && Boolean(reachNow?.ok) !== Boolean(reachBefore?.ok)) {
    previousTotals = { ...previousTotals, reach: null, frequency: null };
  }

  const days = range.from
    ? Math.max(1, daysBetween(range.from, range.to ?? now.toISOString()) + 1)
    : 30;

  const syncedAt =
    lastSyncedAt(ownRows(allRows, { level, objectId })) ?? account?.last_synced_at ?? null;

  return {
    detail,
    allRows,
    previousTotals,
    rankings: level === "ad" ? (latestRankings(allRows)[objectId] ?? null) : null,
    adAccountId,
    currency: account?.currency ?? null,
    period,
    days,
    syncedLabel: syncedLabel(syncedAt, now, timeZone),
    reach: {
      adset: adsetReach?.ok ? adsetReach.data : null,
      ad: adReach?.ok ? adReach.data : null,
    },
    live: { placement, device, audience, hourly },
    meta: {
      objective: objectMeta?.ok ? objectMeta.data.objective : null,
      dailyBudget: objectMeta?.ok ? objectMeta.data.dailyBudget : null,
      lifetimeBudget: objectMeta?.ok ? objectMeta.data.lifetimeBudget : null,
      creative: objectMeta?.ok ? objectMeta.data.creative : null,
      error: objectMeta && !objectMeta.ok ? objectMeta.error : null,
    },
  };
}
