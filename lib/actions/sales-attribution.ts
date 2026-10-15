"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { buildAdOption, type AdOption } from "@/lib/sales/ad-options";
import { sanitizeSearch } from "@/lib/url-params";

/**
 * Los buscadores del selector "Cargar a mano" y del filtro por pieza de Ventas (Extra I, F47 y F49).
 *
 * Piden `sales.view` y leen con el cliente de QUIEN BUSCA: la RLS decide que piezas y que anuncios ve. El catalogo
 * de Meta es de `dashboards.ads.view`: sin ese permiso el buscador de anuncios no devuelve nada y queda "No sé qué
 * anuncio". Lo que se elige se vuelve a comprobar en el servidor al guardar (`registerManualSaleTouch`).
 */

export interface PieceOption {
  id: string;
  title: string;
  code: string;
  format: string | null;
}

/** Las piezas por titulo o por codigo de atribucion (las de la papelera no). */
export async function searchPiecesForSale(query: string): Promise<PieceOption[]> {
  const ctx = await getPermissionAction("sales.view");
  if (!ctx) return [];
  const q = sanitizeSearch(query, 60);
  if (q.length < 2) return [];

  const { data, error } = await ctx.supabase
    .from("content_posts")
    .select("id, title, attribution_code, format")
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .or(`title.ilike.%${q}%,attribution_code.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(8);
  if (error) {
    console.error("[ventas] no pude buscar piezas:", error.message);
    return [];
  }
  return (data ?? []).map((p) => ({ id: p.id, title: p.title, code: p.attribution_code, format: p.format ?? null }));
}

/** El titulo de una pieza (para mostrar el filtro de la lista). Null si no existe o no se ve. */
export async function pieceTitleForSale(pieceId: string): Promise<string | null> {
  const ctx = await getPermissionAction("sales.view");
  if (!ctx || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pieceId)) return null;
  const { data } = await ctx.supabase.from("content_posts").select("title").eq("id", pieceId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  return data?.title ?? null;
}

type NamedRow = { id: string; name: string | null };

/** El catalogo de Meta por nombre o id: anuncios, conjuntos y campañas, cada uno con su camino. */
export async function searchAdsForSale(query: string): Promise<AdOption[]> {
  const ctx = await getPermissionAction("sales.view");
  if (!ctx) return [];
  const q = sanitizeSearch(query, 60);
  if (q.length < 2) return [];
  const { supabase, workspace } = ctx;

  try {
    const [ads, adsets, campaigns] = await Promise.all([
      supabase.from("meta_ads").select("ad_id, name, adset_id, campaign_id").eq("workspace_id", workspace.id).or(`name.ilike.%${q}%,ad_id.ilike.%${q}%`).order("created_time", { ascending: false }).limit(8),
      supabase.from("meta_adsets").select("adset_id, name, campaign_id").eq("workspace_id", workspace.id).or(`name.ilike.%${q}%,adset_id.ilike.%${q}%`).order("created_time", { ascending: false }).limit(4),
      supabase.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", workspace.id).or(`name.ilike.%${q}%,campaign_id.ilike.%${q}%`).order("created_time", { ascending: false }).limit(4),
    ]);

    const adRows = ads.data ?? [];
    const adsetRows = adsets.data ?? [];
    const campaignRows = campaigns.data ?? [];

    // Los nombres de los padres que las filas encontradas mencionan y todavia no estan.
    const adsetIds = [...new Set(adRows.map((a) => a.adset_id).filter((id): id is string => !!id))].filter((id) => !adsetRows.some((s) => s.adset_id === id));
    const campaignIds = [
      ...new Set([...adRows.map((a) => a.campaign_id), ...adsetRows.map((s) => s.campaign_id)].filter((id): id is string => !!id)),
    ].filter((id) => !campaignRows.some((c) => c.campaign_id === id));
    const [parentAdsets, parentCampaigns] = await Promise.all([
      adsetIds.length > 0 ? supabase.from("meta_adsets").select("adset_id, name, campaign_id").eq("workspace_id", workspace.id).in("adset_id", adsetIds) : null,
      campaignIds.length > 0 ? supabase.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", workspace.id).in("campaign_id", campaignIds) : null,
    ]);

    const adsetName = new Map<string, NamedRow & { campaign_id: string | null }>();
    for (const s of [...adsetRows, ...(parentAdsets?.data ?? [])]) adsetName.set(s.adset_id, { id: s.adset_id, name: s.name, campaign_id: s.campaign_id });
    const campaignName = new Map<string, NamedRow>();
    for (const c of [...campaignRows, ...(parentCampaigns?.data ?? [])]) campaignName.set(c.campaign_id, { id: c.campaign_id, name: c.name });

    const options: AdOption[] = [
      ...adRows.map((a) =>
        buildAdOption({
          level: "ad",
          ad: { id: a.ad_id, name: a.name },
          adset: a.adset_id ? (adsetName.get(a.adset_id) ?? { id: a.adset_id, name: null }) : null,
          campaign: a.campaign_id ? (campaignName.get(a.campaign_id) ?? { id: a.campaign_id, name: null }) : null,
        }),
      ),
      ...adsetRows.map((s) =>
        buildAdOption({
          level: "adset",
          adset: { id: s.adset_id, name: s.name },
          campaign: s.campaign_id ? (campaignName.get(s.campaign_id) ?? { id: s.campaign_id, name: null }) : null,
        }),
      ),
      ...campaignRows.map((c) => buildAdOption({ level: "campaign", campaign: { id: c.campaign_id, name: c.name } })),
    ];
    return options;
  } catch (err) {
    console.error("[ventas] no pude buscar anuncios:", err instanceof Error ? err.message : "error desconocido");
    return [];
  }
}
