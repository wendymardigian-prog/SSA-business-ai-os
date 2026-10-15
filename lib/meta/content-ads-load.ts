/**
 * Lo que la sección «Publicidad» de una pieza y la lista de Contenido leen de la base (Extra L, Tirón 2, A2).
 *
 * Todo con el cliente que se le pasa. La pantalla pasa el de QUIEN MIRA, así que la RLS decide qué ve (los anuncios
 * se leen con `dashboards.ads.view`: quien no lo tiene no ve ni el indicador «Pautada»). Los números salen de la misma
 * función que la tabla Meta vs CRM (`ads_crm_metrics_v2`), no de un cálculo aparte.
 *
 * Ninguna función lanza por un fallo de la base: devuelven vacío (o null en los números) y quien llama lo muestra.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { adDetailHref, type CrmRow, type InsightRow, type LinkedAd } from "./content-ad-summary";

type Db = SupabaseClient<Database>;

/** PostgREST corta en 1000 filas sin avisar: se pide de a páginas. */
const PAGE = 1000;
const MAX_PAGES = 10;

/** Los anuncios vinculados a UNA pieza. */
export async function loadLinkedAds(supabase: Db, workspaceId: string, pieceId: string): Promise<LinkedAd[]> {
  const { data, error } = await supabase
    .from("meta_ads")
    .select("ad_id, name, effective_status, status, ad_account_id, content_link_manual")
    .eq("workspace_id", workspaceId)
    .eq("content_post_id", pieceId)
    .order("name");
  if (error) {
    console.error("[contenido] no pude leer los anuncios de la pieza:", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    adId: row.ad_id,
    name: row.name,
    status: row.effective_status ?? row.status ?? null,
    adAccountId: row.ad_account_id,
    href: adDetailHref(row.ad_id, row.ad_account_id),
    manual: row.content_link_manual === true,
  }));
}

/** Los ids de las piezas que tienen al menos un anuncio vinculado (para el indicador y el filtro «Pautadas»). */
export async function loadPaidPieceIds(supabase: Db, workspaceId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("meta_ads")
      .select("content_post_id")
      .eq("workspace_id", workspaceId)
      .not("content_post_id", "is", null)
      .order("id")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) {
      console.error("[contenido] no pude leer las piezas pautadas:", error.message);
      break;
    }
    for (const row of data ?? []) if (row.content_post_id) ids.add(row.content_post_id);
    if ((data ?? []).length < PAGE) break;
  }
  return ids;
}

export interface PieceAdsNumbers {
  /** null = no se pudo leer. */
  insights: InsightRow[] | null;
  crm: CrmRow[] | null;
}

/** Gasto, impresiones y clics (los insights diarios de esos anuncios) y los números del CRM, para un período. */
export async function loadPieceAdsNumbers(
  supabase: Db,
  params: { workspaceId: string; adIds: string[]; since: string; until: string },
): Promise<PieceAdsNumbers> {
  if (params.adIds.length === 0) return { insights: [], crm: [] };

  const insights: InsightRow[] = [];
  let insightsOk = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("meta_ads_insights_daily")
      .select("spend, impressions, clicks")
      .eq("workspace_id", params.workspaceId)
      .eq("level", "ad")
      .in("object_id", params.adIds)
      .gte("date", params.since)
      .lte("date", params.until)
      .order("id")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) {
      console.error("[contenido] no pude leer el gasto de los anuncios de la pieza:", error.message);
      insightsOk = false;
      break;
    }
    insights.push(...((data ?? []) as InsightRow[]));
    if ((data ?? []).length < PAGE) break;
  }

  // Sin cuenta: los anuncios ya son los de la pieza (`p_object_ids`), y pueden ser de cuentas distintas.
  const { data: crm, error: crmError } = await supabase.rpc("ads_crm_metrics_v2", {
    p_level: "ad",
    p_since: params.since,
    p_until: params.until,
    p_workspace_id: params.workspaceId,
    p_object_ids: params.adIds,
  });
  if (crmError) console.error("[contenido] no pude leer los leads de los anuncios de la pieza:", crmError.message);

  return {
    insights: insightsOk ? insights : null,
    crm: crmError ? null : ((crm ?? []) as CrmRow[]),
  };
}
