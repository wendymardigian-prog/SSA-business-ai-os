/**
 * Lo que las tres pantallas de detalle hacen igual (F57).
 *
 * Las tres leen lo mismo: la cuenta elegida, el periodo, las filas y los
 * metadatos en vivo. Repetirlo tres veces serian tres lugares donde
 * arreglar el mismo error.
 */

import { notFound } from "next/navigation";
import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { isPeriodPreset, resolvePeriod, type PeriodPreset } from "@/lib/dashboards/period";
import { DEFAULT_PERIOD } from "@/lib/dashboards/url-state";
import { parseMetaConfig, resolveSyncedAccount, syncedAccounts } from "@/lib/meta/accounts";
import { getMetaToken } from "@/lib/meta/token";
import { fetchObjectMeta, fetchUniqueReach } from "@/lib/meta/live";
import { loadAdsInsights } from "./ads-load";
import { buildDetail, type DetailLevel, type DetailView } from "./ads-detail";
import { daysBetween } from "@/lib/metrics/rules";
import type { AdsRow } from "./ads";

export interface DetailPageData {
  detail: DetailView;
  allRows: AdsRow[];
  adAccountId: string;
  currency: string | null;
  period: PeriodPreset;
  days: number;
  meta: {
    objective: string | null;
    dailyBudget: number | null;
    lifetimeBudget: number | null;
    creative: { title: string | null; body: string | null; thumbnailUrl: string | null; cta: string | null } | null;
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
  const range = resolvePeriod(period, now, workspace.timezone || "America/Costa_Rica");
  const token = await getMetaToken(supabase, workspace.id);

  const allRows = await loadAdsInsights(supabase, {
    workspaceId: workspace.id,
    adAccountId,
    period: range,
  });

  const [live, objectMeta] = await Promise.all([
    token && range.from
      ? fetchUniqueReach({
          token,
          adAccountId,
          objectId: params.objectId,
          since: range.from.slice(0, 10),
          until: (range.to ?? now.toISOString()).slice(0, 10),
        })
      : Promise.resolve(null),
    token
      ? fetchObjectMeta({ token, adAccountId, objectId: params.objectId, level: params.level })
      : Promise.resolve(null),
  ]);

  const detail = buildDetail({
    rows: allRows,
    level: params.level,
    objectId: params.objectId,
    uniqueReach: live?.ok ? live.data.reach : null,
  });

  // Sin filas propias no hay nada que mostrar: el objeto no tuvo actividad
  // en este periodo, o es de otra cuenta.
  if (!detail) notFound();

  const days = range.from
    ? Math.max(1, daysBetween(range.from, range.to ?? now.toISOString()) + 1)
    : 30;

  return {
    detail,
    allRows,
    adAccountId,
    currency: account?.currency ?? null,
    period,
    days,
    meta: {
      objective: objectMeta?.ok ? objectMeta.data.objective : null,
      dailyBudget: objectMeta?.ok ? objectMeta.data.dailyBudget : null,
      lifetimeBudget: objectMeta?.ok ? objectMeta.data.lifetimeBudget : null,
      creative: objectMeta?.ok ? objectMeta.data.creative : null,
      error: objectMeta && !objectMeta.ok ? objectMeta.error : null,
    },
  };
}
