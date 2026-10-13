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
import { markCatalogSync, markSync, parseMetaConfig, syncedAccounts, type AdAccount } from "@/lib/meta/accounts";
import { fetchInsights, syncRange, type InsightRow } from "@/lib/meta/insights";
import { fetchEntities, MAX_ENTITY_PAGES, updatedSinceFor, type CatalogLevel } from "@/lib/meta/entities";
import { loadStatuses, persistAdsets, persistAds, persistCampaigns, type StatusMap } from "@/lib/meta/catalog-store";
import { linkAdsToContent } from "@/lib/meta/content-link";
import { scheduleThumbnailJob } from "@/lib/meta/thumbnails";

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
  params: { workspaceId: string; adAccountId: string; rows: InsightRow[]; statuses?: StatusMap },
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
    video_avg_time_seconds: row.videoAvgTimeSeconds,
    quality_ranking: row.qualityRanking,
    engagement_ranking: row.engagementRanking,
    conversion_ranking: row.conversionRanking,
    // El estado sale del catalogo (AT2): sin catalogo queda null, como siempre.
    status: params.statuses?.get(`${row.level}:${row.objectId}`)?.status ?? null,
    effective_status: params.statuses?.get(`${row.level}:${row.objectId}`)?.effectiveStatus ?? null,
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


/** Cuantos dias hacia atras se vuelven a resolver los toques sin vincular despues de cada sync. */
const REMATCH_DAYS = 90;

const LEVEL_LABEL: Record<CatalogLevel, string> = { campaign: "campañas", adset: "conjuntos", ad: "anuncios" };

export interface CatalogSyncResult {
  campaigns: number;
  adsets: number;
  ads: number;
  /** Se leyeron los tres niveles hasta el final. */
  complete: boolean;
  /** Lo que hay que decirle a la persona (tope, limite de uso, un error de Meta). Null si todo salio bien. */
  note: string | null;
}

/**
 * Trae el catalogo (campañas, conjuntos y anuncios) de UNA cuenta y lo guarda.
 *
 * Va ANTES de las metricas y es independiente de ellas: si falla, las metricas se sincronizan
 * igual (y al reves). Nunca lanza. En la primera vez (sin `catalog_synced_at`) lee todo; despues,
 * solo lo que cambio desde la ultima vez completa, con un dia de margen.
 */
export async function syncCatalog(
  supabase: Db,
  params: { token: string; workspaceId: string; adAccountId: string; account: AdAccount; now: Date },
): Promise<CatalogSyncResult> {
  const updatedSince = updatedSinceFor(params.account.catalog_synced_at);
  const result: CatalogSyncResult = { campaigns: 0, adsets: 0, ads: 0, complete: true, note: null };
  const notes: string[] = [];
  const base = { workspaceId: params.workspaceId, adAccountId: params.adAccountId, at: params.now };

  for (const level of ["campaign", "adset", "ad"] as const) {
    try {
      const fetched = await fetchEntities({ token: params.token, adAccountId: params.adAccountId, level, updatedSince });

      if (!fetched.ok) {
        result.complete = false;
        notes.push(`Catálogo (${LEVEL_LABEL[level]}): ${fetched.error}`);
        // Un limite de uso o una caida de red afecta a los tres niveles: no se insiste.
        if (fetched.retryable) break;
        continue;
      }

      if (fetched.deletedRejected) {
        console.log(`[meta-ads] ${params.adAccountId}: Meta no acepto DELETED en ${LEVEL_LABEL[level]}; se leyo sin los borrados`);
      }
      if (fetched.stopReason === "capped") {
        result.complete = false;
        notes.push(`Catálogo incompleto: se llegó al tope de ${MAX_ENTITY_PAGES} páginas en ${LEVEL_LABEL[level]}`);
      } else if (fetched.stopReason === "usage") {
        result.complete = false;
        notes.push("Catálogo incompleto: Meta está cerca de su límite de uso; sigue en el próximo ciclo");
      }

      if (level === "campaign") result.campaigns = await persistCampaigns(supabase, { ...base, rows: fetched.rows as never });
      if (level === "adset") result.adsets = await persistAdsets(supabase, { ...base, rows: fetched.rows as never });
      if (level === "ad") {
        const ads = fetched.rows as import("@/lib/meta/entities").AdEntity[];
        result.ads = await persistAds(supabase, { ...base, rows: ads });
        await linkAdsToContent(supabase, {
          workspaceId: params.workspaceId,
          adAccountId: params.adAccountId,
          ads: ads.map((a) => ({ adId: a.adId, instagramMediaId: a.instagramMediaId, objectStoryId: a.objectStoryId })),
        });
      }

      if (fetched.stopReason === "usage") break;
    } catch (err) {
      // Un fallo inesperado de un nivel no puede frenar el resto del sync.
      result.complete = false;
      notes.push(`Catálogo (${LEVEL_LABEL[level]}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Re-vincular los toques de los ultimos 90 dias que quedaron sin anuncio (AT3, F28): quizas el sync
  // acaba de traer justo el anuncio que faltaba. Nunca lanza: un fallo aca no frena nada.
  try {
    const { error } = await supabase.rpc("rematch_meta_touches", {
      p_workspace_id: params.workspaceId,
      p_since: new Date(params.now.getTime() - REMATCH_DAYS * 86_400_000).toISOString(),
    });
    if (error) console.error("[meta-ads] no pude re-vincular los toques:", error.message);
  } catch (err) {
    console.error("[meta-ads] no pude re-vincular los toques:", err instanceof Error ? err.message : err);
  }

  result.note = notes[0] ?? null;
  return result;
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

  // Primero el catalogo (AT2): entidades, estado y enlaces. Es independiente de las metricas.
  const catalog = await syncCatalog(supabase, {
    token,
    workspaceId: payload.workspaceId,
    adAccountId: payload.adAccountId,
    account,
    now,
  });

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

    // El estado de cada objeto sale del catalogo recien sincronizado (y del ya guardado).
    const statuses = await loadStatuses(supabase, {
      workspaceId: payload.workspaceId,
      adAccountId: payload.adAccountId,
      ids: {
        campaign: result.rows.filter((r) => r.level === "campaign").map((r) => r.objectId),
        adset: result.rows.filter((r) => r.level === "adset").map((r) => r.objectId),
        ad: result.rows.filter((r) => r.level === "ad").map((r) => r.objectId),
      },
    });

    total += await persistInsights(supabase, {
      workspaceId: payload.workspaceId,
      adAccountId: payload.adAccountId,
      rows: result.rows,
      statuses,
    });
  }

  // `markSync` decide "primera vez completa" solo por las metricas; el aviso del catalogo (tope,
  // limite de uso, error de Meta) se suma despues para que no se corte en silencio.
  const updated = markCatalogSync(
    markSync(config.ad_accounts, payload.adAccountId, {
      at: now.toISOString(),
      error: errors[0] ?? null,
      firstSync: !account.first_sync_completed_at,
    }),
    payload.adAccountId,
    { at: now.toISOString(), complete: catalog.complete, note: errors[0] ? null : catalog.note },
  );

  await supabase
    .from("integration_configs")
    .update({ config: { ...config, ad_accounts: updated } as unknown as Json })
    .eq("workspace_id", payload.workspaceId)
    .eq("type", "meta")
    .eq("provider", "meta");

  // Las miniaturas van al final y en su propio job: un fallo de descarga no frena nada de esto.
  try {
    await scheduleThumbnailJob(supabase, payload.workspaceId, payload.adAccountId, now);
  } catch (err) {
    console.error("[meta-ads] no pude encolar las miniaturas:", err instanceof Error ? err.message : err);
  }

  console.log(
    `[meta-ads] ${payload.adAccountId}: ${total} filas, catalogo ${catalog.campaigns}/${catalog.adsets}/${catalog.ads}${errors.length > 0 ? `, ${errors.length} nivel(es) con error` : ""}${catalog.note ? `, ${catalog.note}` : ""}`,
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
