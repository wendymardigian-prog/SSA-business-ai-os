/**
 * Lee de la base lo que dibuja el dashboard de anuncios (F56, F57).
 *
 * Solo lectura con el cliente del usuario: `meta_ads_insights_daily` la lee
 * Owner/Admin y nadie mas, y eso lo decide la base.
 *
 * Una sola consulta por periodo trae los cuatro niveles. Filtrar por
 * campaña o conjunto se hace despues, en memoria: son miles de filas, no
 * millones, y evita cuatro consultas mas por cada pantalla de detalle.
 *
 * Se lee de a paginas: PostgREST corta cada respuesta en 1.000 filas sin avisar, y
 * eso dejaba afuera dias enteros de gasto en los periodos largos. El orden es
 * estable (una fila por dia, nivel y objeto) para que no se repita ni falte una
 * entre pagina y pagina.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { isoToDateInput } from "@/lib/dates";
import { fetchAllPages } from "@/lib/shared/paginate";
import type { AdsRow } from "./ads";
import type { ResolvedPeriod } from "./period";

type Db = SupabaseClient<Database>;

export async function loadAdsInsights(
  supabase: Db,
  params: {
    workspaceId: string;
    adAccountId: string;
    period: ResolvedPeriod;
    /**
     * La misma zona con la que se armo `period` (resolvePeriod). `date` es un
     * DATE, no un timestamptz: cortar el ISO de `period.from`/`to` con
     * `.slice(0, 10)` da el dia en UTC, que es un dia distinto del que se
     * pidio para cualquier zona adelantada a UTC.
     */
    timeZone: string;
  },
): Promise<AdsRow[]> {
  const since = params.period.from ? isoToDateInput(params.period.from, params.timeZone) : null;
  const until = params.period.to ? isoToDateInput(params.period.to, params.timeZone) : null;

  const { rows, truncated, error } = await fetchAllPages((from, to) => {
    let query = supabase
      .from("meta_ads_insights_daily")
      // En una sola linea a proposito: partido en varias, el tipado de
      // PostgREST no infiere las columnas y todo vuelve como `unknown`.
      .select("level, object_id, object_name, parent_name, campaign_id, adset_id, date, spend, impressions, reach, clicks, outbound_clicks, link_clicks, leads, purchases, purchase_value, status, effective_status, quality_ranking, engagement_ranking, conversion_ranking, video_p25, video_p50, video_p75, video_p95, video_p100, thruplays, video_avg_time_seconds, actions, updated_at")
      .eq("workspace_id", params.workspaceId)
      .eq("ad_account_id", params.adAccountId);

    if (since) query = query.gte("date", since);
    if (until) query = query.lte("date", until);

    return query.order("date").order("level").order("object_id").range(from, to);
  });

  // A medias daria numeros que parecen ciertos y no lo son: si falla una pagina, no se muestra ninguna.
  if (error) {
    console.error("[ads] no pude leer los insights:", error);
    return [];
  }
  if (truncated) console.error("[ads] los insights pasaron el tope de lectura: los totales quedan cortos");

  return rows.map((row) => ({
    level: row.level,
    objectId: row.object_id,
    objectName: row.object_name,
    parentName: row.parent_name,
    campaignId: row.campaign_id,
    adsetId: row.adset_id,
    date: row.date,
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    outboundClicks: row.outbound_clicks,
    linkClicks: row.link_clicks,
    leads: row.leads,
    purchases: row.purchases,
    purchaseValue: row.purchase_value,
    status: row.status,
    effectiveStatus: row.effective_status,
    qualityRanking: row.quality_ranking,
    engagementRanking: row.engagement_ranking,
    conversionRanking: row.conversion_ranking,
    videoP25: row.video_p25,
    videoP50: row.video_p50,
    videoP75: row.video_p75,
    videoP95: row.video_p95,
    videoP100: row.video_p100,
    thruplays: row.thruplays,
    videoAvgTimeSeconds: row.video_avg_time_seconds,
    actions: parseActions(row.actions),
    updatedAt: row.updated_at,
  }));
}

/**
 * Las acciones guardadas, como `{ tipo: cantidad }`.
 *
 * Es un jsonb que escribe el sync, pero se lee sin confiar: cualquier cosa
 * que no sea un numero se descarta en vez de romper la pantalla.
 */
export function parseActions(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [type, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) out[type] = n;
  }
  return out;
}
