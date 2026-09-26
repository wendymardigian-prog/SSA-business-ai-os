/**
 * El job que trae los insights de UNA cuenta publicitaria (F55).
 *
 * Los cuatro niveles en la misma corrida, y si uno falla los otros se
 * guardan igual: un error a nivel anuncio no puede dejar sin datos al
 * dashboard de la cuenta.
 *
 * El limite de uso de Meta se respeta cortando: pasado el 90% de la cuota,
 * lo que queda se deja para la corrida siguiente. Insistir hasta que Meta
 * bloquee cuesta una hora de nada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdsLevel, Database, Json } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { getMetaToken } from "@/lib/meta/token";
import { markSync, parseMetaConfig, syncedAccounts } from "@/lib/meta/accounts";
import { fetchInsights, syncRange, type InsightRow } from "@/lib/meta/insights";

type Db = SupabaseClient<Database>;

export const META_ADS_SYNC_JOB = "meta_ads_sync";

export interface MetaAdsSyncPayload {
  workspaceId?: string;
  adAccountId?: string;
}

const LEVELS: AdsLevel[] = ["account", "campaign", "adset", "ad"];

/** Guarda las filas leidas. Upsert: la misma corrida dos veces no duplica. */
export async function persistInsights(
  supabase: Db,
  params: { workspaceId: string; adAccountId: string; rows: InsightRow[] },
): Promise<number> {
  if (params.rows.length === 0) return 0;

  const payload = params.rows.map((row) => ({
    workspace_id: params.workspaceId,
    ad_account_id: params.adAccountId,
    level: row.level as AdsLevel,
    object_id: row.objectId,
    object_name: row.objectName,
    parent_name: row.parentName,
    campaign_id: row.campaignId,
    adset_id: row.adsetId,
    date: row.date,
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    outbound_clicks: row.outboundClicks,
    link_clicks: row.linkClicks,
    ctr: row.ctr,
    cpc: row.cpc,
    cpm: row.cpm,
    leads: row.leads,
    purchases: row.purchases,
    purchase_value: row.purchaseValue,
    video_p25: row.videoP25,
    video_p50: row.videoP50,
    video_p75: row.videoP75,
    video_p95: row.videoP95,
    video_p100: row.videoP100,
    thruplays: row.thruplays,
    quality_ranking: row.qualityRanking,
    engagement_ranking: row.engagementRanking,
    conversion_ranking: row.conversionRanking,
    actions: row.actions as unknown as Json,
  }));

  // De a 500: un upsert de miles de filas de una tarda mas que el timeout
  // de la funcion.
  let written = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { error } = await supabase
      .from("meta_ads_insights_daily")
      .upsert(chunk, { onConflict: "workspace_id,level,object_id,date" });

    if (error) {
      console.error("[meta-ads] no pude guardar un lote:", error.message);
      continue;
    }
    written += chunk.length;
  }

  return written;
}

async function handleMetaAdsSync({ supabase, job }: JobContext): Promise<void> {
  const payload = (job.payload ?? {}) as MetaAdsSyncPayload;
  if (!payload.workspaceId || !payload.adAccountId) {
    throw new Error(`job ${job.id} de anuncios sin workspaceId o adAccountId`);
  }

  const token = await getMetaToken(supabase, payload.workspaceId);
  if (!token) {
    console.error("[meta-ads] no hay token de Meta guardado");
    return;
  }

  const { data: row } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", payload.workspaceId)
    .eq("type", "meta")
    .eq("provider", "meta")
    .maybeSingle();

  const config = parseMetaConfig(row?.config);
  const account = config.ad_accounts.find((a) => a.ad_account_id === payload.adAccountId);

  if (!account || !account.sync_enabled) {
    console.log(`[meta-ads] ${payload.adAccountId} ya no se sincroniza`);
    return;
  }

  const now = new Date();
  const range = syncRange({ now, firstSync: !account.first_sync_completed_at });

  let total = 0;
  const errors: string[] = [];

  for (const level of LEVELS) {
    const result = await fetchInsights({
      token,
      adAccountId: payload.adAccountId,
      level,
      since: range.since,
      until: range.until,
    });

    if (!result.ok) {
      // Un nivel que falla no frena a los demas: el dashboard de la cuenta
      // sirve aunque falte el detalle por anuncio.
      errors.push(`${level}: ${result.error}`);
      if (!result.retryable) break;
      continue;
    }

    total += await persistInsights(supabase, {
      workspaceId: payload.workspaceId,
      adAccountId: payload.adAccountId,
      rows: result.rows,
    });
  }

  const updated = markSync(config.ad_accounts, payload.adAccountId, {
    at: now.toISOString(),
    error: errors[0] ?? null,
    firstSync: !account.first_sync_completed_at,
  });

  await supabase
    .from("integration_configs")
    .update({ config: { ...config, ad_accounts: updated } as unknown as Json })
    .eq("workspace_id", payload.workspaceId)
    .eq("type", "meta")
    .eq("provider", "meta");

  console.log(
    `[meta-ads] ${payload.adAccountId}: ${total} filas${errors.length > 0 ? `, ${errors.length} nivel(es) con error` : ""}`,
  );
}

export function registerMetaAdsHandlers(): void {
  registerJobHandler(META_ADS_SYNC_JOB, handleMetaAdsSync);
}

/** Las cuentas publicitarias que toca sincronizar de un workspace. */
export async function adAccountsToSync(supabase: Db, workspaceId: string): Promise<string[]> {
  const { data } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("workspace_id", workspaceId)
    .eq("type", "meta")
    .eq("provider", "meta")
    .maybeSingle();

  return syncedAccounts(parseMetaConfig(data?.config).ad_accounts).map((a) => a.ad_account_id);
}
