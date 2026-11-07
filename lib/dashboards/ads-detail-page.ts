/**
 * Lo que las tres pantallas de detalle hacen igual (F57).
 *
 * Las tres leen lo mismo: la cuenta elegida, el periodo, las filas y los
 * metadatos en vivo. Repetirlo tres veces serian tres lugares donde
 * arreglar el mismo error.
 */

import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/guards";
import { previousPeriod } from "@/lib/dashboards/period";
import { readDashboardPeriod, resolveDashboardPeriod, type PeriodFilter } from "@/lib/dashboards/period-filter";
import { parseMetaConfig, resolveSyncedAccount, syncedAccounts } from "@/lib/meta/accounts";
import { getMetaToken } from "@/lib/meta/token";
import { createServiceClient } from "@/lib/supabase/server";
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
import { loadCrmForRows, type CrmTableData } from "./ads-crm-load";
import { buildDetail, ownRows, type DetailLevel, type DetailView } from "./ads-detail";
import { lastSyncedAt, syncedLabel, type Rankings, latestRankings } from "./ads-view";
import { computeTotals, type AdsRow, type AdsTotals } from "./ads";
import { daysBetween } from "@/lib/metrics/rules";
import type { AdContentLink } from "@/lib/meta/content-ad-summary";
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
  period: PeriodFilter;
  days: number;
  /** "hoy 14:32": la ultima escritura del sync. */
  syncedLabel: string | null;
  /** Alcance unico de los hijos (conjuntos y anuncios de este objeto). */
  adReach: Record<string, number> | null;
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
  /** La pieza de Contenido a la que está vinculado este anuncio (solo en el nivel anuncio), o null (Tirón 2, A2). */
  contentLink: AdContentLink | null;
  /** Quien mira puede vincular el anuncio con una pieza: `content.create` (ya tiene `dashboards.ads.view` para estar acá). */
  canLinkContent: boolean;
  /** Lo que dice el CRM (la tabla de los hijos y el funnel). Si falla, se ve lo de Meta y lo avisa. */
  crm: CrmTableData;
}

/** El objeto existe en esta cuenta, pero no tuvo datos en el rango elegido. */
export interface EmptyDetailPageData {
  empty: true;
  adAccountId: string;
  period: PeriodFilter;
}

export async function loadDetailPage(params: {
  level: DetailLevel;
  objectId: string;
  searchParams: Record<string, string | string[] | undefined>;
}): Promise<DetailPageData | EmptyDetailPageData> {
  // El permiso, no el cargo (F32).
  const permissions = await requirePermission("dashboards.ads.view");
  const { workspace, supabase, can } = permissions;
  const sp = params.searchParams;

  const period = readDashboardPeriod(sp);

  // Las cuentas estan en `integration_configs` (solo la lee un Admin): con el permiso de la pantalla se leen con el
  // cliente de servicio, filtradas por el workspace de la sesion.
  const { data: configRow } = await (await createServiceClient())
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
  const range = resolveDashboardPeriod(period, now, timeZone);
  const before = previousPeriod(range, now);
  // Con el de servicio: desde la 00143 `read_secret` solo la ejecuta el
  // servidor. El workspace sale del guard de Admin, no del pedido.
  const token = await getMetaToken(await createServiceClient(), workspace.id);

  const sinceOf = (p: { from: string | null }) => (p.from ? isoToDateInput(p.from, timeZone) : null);
  const untilOf = (p: { to: string | null }) => isoToDateInput(p.to ?? now.toISOString(), timeZone);

  const objectId = params.objectId;
  const level = params.level;
  const live = <T>(run: (since: string, until: string) => Promise<LiveResult<T>>): Promise<Live<T>> =>
    token && range.from ? run(sinceOf(range) as string, untilOf(range)) : Promise.resolve(null);
  const breakdownOf = (breakdown: BreakdownKind) =>
    live((since, until) => fetchBreakdown({ token: token as string, adAccountId, objectId, breakdown, since, until }));

  const [allRows, previousRows, reachNow, reachBefore, objectMeta, adReach, placement, device, audience, hourly] =
    await Promise.all([
      loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: range, timeZone }),
      loadAdsInsights(supabase, { workspaceId: workspace.id, adAccountId, period: before, timeZone }),
      live((since, until) => fetchUniqueReach({ token: token as string, adAccountId, objectId, since, until })),
      token && before.from
        ? fetchUniqueReach({ token, adAccountId, objectId, since: sinceOf(before) as string, until: untilOf(before) })
        : Promise.resolve(null),
      token ? fetchObjectMeta({ token, adAccountId, objectId, level }) : Promise.resolve(null),
      level === "ad"
        ? Promise.resolve(null)
        : live((since, until) => fetchReachByLevel({ token: token as string, adAccountId, objectId, level: "ad", since, until })),
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
    uniqueFrequency: reachNow?.ok ? reachNow.data.frequency : null,
  });

  // Sin filas propias en el rango: si el objeto existe en esta cuenta, la pantalla lo dice y deja elegir otro rango
  // (con un rango a mano pasa seguido). Si no tiene ninguna fila en ninguna fecha, no es de esta cuenta.
  if (!detail) {
    const { data: known } = await supabase
      .from("meta_ads_insights_daily")
      .select("object_id")
      .eq("workspace_id", workspace.id)
      .eq("ad_account_id", adAccountId)
      .eq("level", level)
      .eq("object_id", objectId)
      .limit(1);
    if (!known?.length) notFound();
    return { empty: true, adAccountId, period };
  }

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

  const crm = await loadCrmForRows(permissions, {
    adAccountId,
    rows: allRows,
    since: sinceOf(range) ?? "2000-01-01",
    until: untilOf(range),
    timeZone,
    now,
  });

  // El vínculo manual con una pieza de Contenido (A2): solo se muestra en el menú del anuncio.
  let contentLink: AdContentLink | null = null;
  if (level === "ad") {
    const { data: adRow } = await supabase
      .from("meta_ads")
      .select("content_post_id, content_link_manual")
      .eq("workspace_id", workspace.id)
      .eq("ad_id", objectId)
      .limit(1)
      .maybeSingle();
    if (adRow?.content_post_id) {
      const { data: piece } = await supabase
        .from("content_posts")
        .select("id, title")
        .eq("id", adRow.content_post_id)
        .eq("workspace_id", workspace.id)
        .maybeSingle();
      if (piece) contentLink = { pieceId: piece.id, pieceTitle: piece.title, manual: adRow.content_link_manual === true };
    }
  }

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
    adReach: adReach?.ok ? adReach.data : null,
    live: { placement, device, audience, hourly },
    meta: {
      objective: objectMeta?.ok ? objectMeta.data.objective : null,
      dailyBudget: objectMeta?.ok ? objectMeta.data.dailyBudget : null,
      lifetimeBudget: objectMeta?.ok ? objectMeta.data.lifetimeBudget : null,
      creative: objectMeta?.ok ? objectMeta.data.creative : null,
      error: objectMeta && !objectMeta.ok ? objectMeta.error : null,
    },
    contentLink,
    canLinkContent: level === "ad" && can("content.create"),
    crm,
  };
}
