/**
 * Guardar y leer el catalogo de Meta (Extra L, AT2, F23).
 *
 * Todo con el cliente de servicio: las tres tablas las escribe solo el servidor.
 *
 * Dos cuidados:
 *  - El upsert de anuncios NO manda `social_post_id`, `content_post_id`, `content_link_manual`,
 *    `thumbnail_path` ni `thumbnail_attempts`: un sync no puede borrar un enlace manual ni tirar
 *    una miniatura ya bajada.
 *  - Un lote que falla se anota y se sigue con el siguiente, igual que las metricas. Pero NO se calla: se devuelve
 *    cuantas filas no se pudieron guardar y por que, para que el sync deje el catalogo como incompleto (si no, la
 *    proxima corrida seria incremental y esas filas no volverian nunca: Tiron 2, E1).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type { AdEntity, AdsetEntity, CampaignEntity } from "./entities";

type Db = SupabaseClient<Database>;

const CHUNK = 500;

/** Lo que paso al guardar: cuantas filas entraron, cuantas no, y el primer motivo. */
export interface PersistResult {
  written: number;
  failed: number;
  error: string | null;
}

async function upsertChunks(supabase: Db, table: "meta_campaigns" | "meta_adsets" | "meta_ads", rows: Record<string, unknown>[], onConflict: string): Promise<PersistResult> {
  const result: PersistResult = { written: 0, failed: 0, error: null };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(chunk as never, { onConflict });
    if (error) {
      console.error(`[meta-ads] no pude guardar un lote de ${table}:`, error.message);
      result.failed += chunk.length;
      result.error ??= error.message;
      continue;
    }
    result.written += chunk.length;
  }
  return result;
}

export async function persistCampaigns(supabase: Db, params: { workspaceId: string; adAccountId: string; rows: CampaignEntity[]; at: Date }): Promise<PersistResult> {
  const payload = params.rows.map((r) => ({
    workspace_id: params.workspaceId,
    ad_account_id: params.adAccountId,
    campaign_id: r.campaignId,
    name: r.name,
    name_key: r.nameKey,
    status: r.status,
    effective_status: r.effectiveStatus,
    objective: r.objective,
    buying_type: r.buyingType,
    daily_budget: r.dailyBudget,
    lifetime_budget: r.lifetimeBudget,
    start_time: r.startTime,
    stop_time: r.stopTime,
    created_time: r.createdTime,
    synced_at: params.at.toISOString(),
  }));
  return upsertChunks(supabase, "meta_campaigns", payload, "workspace_id,ad_account_id,campaign_id");
}

export async function persistAdsets(supabase: Db, params: { workspaceId: string; adAccountId: string; rows: AdsetEntity[]; at: Date }): Promise<PersistResult> {
  const payload = params.rows.map((r) => ({
    workspace_id: params.workspaceId,
    ad_account_id: params.adAccountId,
    adset_id: r.adsetId,
    campaign_id: r.campaignId,
    name: r.name,
    name_key: r.nameKey,
    status: r.status,
    effective_status: r.effectiveStatus,
    optimization_goal: r.optimizationGoal,
    billing_event: r.billingEvent,
    daily_budget: r.dailyBudget,
    lifetime_budget: r.lifetimeBudget,
    start_time: r.startTime,
    stop_time: r.stopTime,
    created_time: r.createdTime,
    synced_at: params.at.toISOString(),
  }));
  return upsertChunks(supabase, "meta_adsets", payload, "workspace_id,ad_account_id,adset_id");
}

export async function persistAds(supabase: Db, params: { workspaceId: string; adAccountId: string; rows: AdEntity[]; at: Date }): Promise<PersistResult> {
  const payload = params.rows.map((r) => ({
    workspace_id: params.workspaceId,
    ad_account_id: params.adAccountId,
    ad_id: r.adId,
    campaign_id: r.campaignId,
    adset_id: r.adsetId,
    name: r.name,
    name_key: r.nameKey,
    status: r.status,
    effective_status: r.effectiveStatus,
    created_time: r.createdTime,
    creative_id: r.creativeId,
    creative: r.creative as unknown as Json,
    thumbnail_source_url: r.thumbnailSourceUrl,
    instagram_media_id: r.instagramMediaId,
    object_story_id: r.objectStoryId,
    synced_at: params.at.toISOString(),
  }));
  return upsertChunks(supabase, "meta_ads", payload, "workspace_id,ad_account_id,ad_id");
}

export interface CatalogStatus {
  status: string | null;
  effectiveStatus: string | null;
}

/** `${level}:${objectId}` -> estado, para los ids que piden. */
export type StatusMap = Map<string, CatalogStatus>;

const LOOKUP_CHUNK = 200;

/**
 * El estado del catalogo para los objetos de unas filas de metricas. Se lee de la base (no de
 * lo recien traido) porque un sync incremental solo trae lo que cambio: lo demas ya esta guardado.
 */
export async function loadStatuses(
  supabase: Db,
  params: { workspaceId: string; adAccountId: string; ids: { campaign: string[]; adset: string[]; ad: string[] } },
): Promise<StatusMap> {
  const map: StatusMap = new Map();
  const plan = [
    { level: "campaign", table: "meta_campaigns", column: "campaign_id", ids: params.ids.campaign },
    { level: "adset", table: "meta_adsets", column: "adset_id", ids: params.ids.adset },
    { level: "ad", table: "meta_ads", column: "ad_id", ids: params.ids.ad },
  ] as const;

  for (const { level, table, column, ids } of plan) {
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
      const { data, error } = await supabase
        .from(table)
        .select(`${column}, status, effective_status`)
        .eq("workspace_id", params.workspaceId)
        .eq("ad_account_id", params.adAccountId)
        .in(column, unique.slice(i, i + LOOKUP_CHUNK));
      if (error) {
        console.error(`[meta-ads] no pude leer los estados de ${table}:`, error.message);
        continue;
      }
      for (const row of (data ?? []) as unknown as Array<Record<string, string | null>>) {
        map.set(`${level}:${row[column]}`, { status: row.status ?? null, effectiveStatus: row.effective_status ?? null });
      }
    }
  }
  return map;
}
