/**
 * Lo que la tabla «Meta vs CRM» necesita ademas de las metricas de Meta (Extra L, AT4, F31; Tirón 2, B y E).
 *
 * Todo con el cliente de QUIEN MIRA: `ads_crm_metrics_v2` es SECURITY INVOKER (la RLS decide que contactos,
 * agendas y ventas cuenta), y el catalogo y las miniaturas tienen RLS por `dashboards.ads.view`.
 * **Nada de esto puede tumbar el dashboard**: si algo falla, la tabla se ve con lo de Meta y avisa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { publicationUrlOf, type AdLink, type CatalogEntry, type CrmLevel, type CrmMetrics, type DistinctLeads } from "./ads-crm";

type Db = SupabaseClient<Database>;

export interface CrmTableData {
  metrics: Record<CrmLevel, CrmMetrics[]>;
  /** Las personas DISTINTAS de todo el filtro, por nivel (la fila `is_total`). Null si no llego: el total suma las filas. */
  distinct: Record<CrmLevel, DistinctLeads | null>;
  catalog: Record<CrmLevel, Record<string, CatalogEntry>>;
  /** Que anuncio cuelga de que conjunto y campaña (catalogo), para «# anuncios». */
  adLinks: AdLink[];
  /** Toques sin vincular de los ultimos 90 dias (los mismos que lista «Sin vincular»). */
  unmatchedCount: number;
  /** Quien mira no ve todos los leads: la tabla cuenta solo los de su alcance. */
  scopeLimited: boolean;
  /** El rango pedido (fechas civiles), para el nombre del CSV y para abrir el detalle de una celda. */
  since: string;
  until: string;
  /** La cuenta publicitaria y el workspace de lo que se muestra (para el detalle de una celda). */
  adAccountId: string;
  /** La zona horaria de quien mira, para las fechas del detalle de una celda. La pagina la completa. */
  timeZone?: string;
  /** Si `ads_crm_metrics_v2` fallo, el motivo (la tabla se muestra igual, sin el CRM). */
  error: string | null;
  /** `data.export`: ofrece «Exportar CSV» (Equipo y roles, F24). La pagina lo completa; sin esto, no se ofrece. */
  canExport?: boolean;
}

export const EMPTY_CRM: CrmTableData = {
  metrics: { campaign: [], adset: [], ad: [] },
  distinct: { campaign: null, adset: null, ad: null },
  catalog: { campaign: {}, adset: {}, ad: {} },
  adLinks: [],
  unmatchedCount: 0,
  scopeLimited: false,
  since: "",
  until: "",
  adAccountId: "",
  error: null,
};

const LEVELS: CrmLevel[] = ["campaign", "adset", "ad"];
const CHUNK = 200;
const THUMBNAIL_SECONDS = 3600;
const UNMATCHED_DAYS = 90;

export interface RpcRow {
  object_id: string | null;
  is_total?: boolean | null;
  leads_first: number | null;
  leads_total: number | null;
  leads_with_booking: number | null;
  bookings: number | null;
  bookings_attended: number | null;
  sales: number | null;
  revenue_cents: number | string | null;
  cash_cents: number | string | null;
  uf_cash_cents?: number | string | null;
}

/** Los `bigint` de la base llegan como numero o como texto: se pasan a numero sin confiar. */
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Las filas de objetos (sin la fila de total). */
export function mapMetrics(rows: RpcRow[] | null | undefined): CrmMetrics[] {
  return (rows ?? [])
    .filter((r) => !r.is_total && r.object_id)
    .map((r) => ({
      objectId: r.object_id as string,
      leadsNew: num(r.leads_first),
      leadsTotal: num(r.leads_total),
      leadsWithBooking: num(r.leads_with_booking),
      bookings: num(r.bookings),
      bookingsAttended: num(r.bookings_attended),
      sales: num(r.sales),
      revenueCents: num(r.revenue_cents),
      cashCents: num(r.cash_cents),
      ufCashCents: num(r.uf_cash_cents),
    }));
}

/** La fila de total (personas distintas), o null si la funcion no la mando. */
export function mapDistinct(rows: RpcRow[] | null | undefined): DistinctLeads | null {
  const total = (rows ?? []).find((r) => r.is_total);
  if (!total) return null;
  return { leadsTotal: num(total.leads_total), leadsWithBooking: num(total.leads_with_booking) };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function loadCrmData(
  supabase: Db,
  params: {
    workspaceId: string;
    adAccountId: string;
    /** Fechas civiles (YYYY-MM-DD). */
    since: string;
    until: string;
    /** Los ids de los objetos que ya tienen metricas de Meta en el periodo, por nivel. */
    objectIds: Record<CrmLevel, string[]>;
    scopeLimited: boolean;
    now?: Date;
  },
): Promise<CrmTableData> {
  const data: CrmTableData = {
    ...EMPTY_CRM,
    metrics: { campaign: [], adset: [], ad: [] },
    distinct: { campaign: null, adset: null, ad: null },
    catalog: { campaign: {}, adset: {}, ad: {} },
    adLinks: [],
    since: params.since,
    until: params.until,
    adAccountId: params.adAccountId,
    scopeLimited: params.scopeLimited,
  };

  try {
    // 1. El CRM, por nivel. Cada uno por su cuenta: si uno falla, los otros se muestran.
    const results = await Promise.all(
      LEVELS.map((level) =>
        supabase.rpc("ads_crm_metrics_v2", {
          p_level: level,
          p_since: params.since,
          p_until: params.until,
          p_ad_account_id: params.adAccountId,
          p_workspace_id: params.workspaceId,
        }),
      ),
    );
    results.forEach((result, index) => {
      if (result.error) {
        console.error(`[ads] no pude leer las metricas del CRM (${LEVELS[index]}):`, result.error.message);
        data.error = data.error ?? result.error.message;
      } else {
        const rows = result.data as unknown as RpcRow[];
        data.metrics[LEVELS[index]] = mapMetrics(rows);
        data.distinct[LEVELS[index]] = mapDistinct(rows);
      }
    });

    // 2. El catalogo (nombre, estado, padres, objetivo, miniatura y publicacion) de todo lo que va a aparecer en la tabla.
    const ids = (level: CrmLevel) => [...new Set([...params.objectIds[level], ...data.metrics[level].map((m) => m.objectId)])];

    const campaignIds = ids("campaign");
    const adsetIds = ids("adset");
    const adIds = ids("ad");

    const [campaigns, adsets, ads] = await Promise.all([
      Promise.all(chunks(campaignIds, CHUNK).map((c) => supabase.from("meta_campaigns").select("campaign_id, name, effective_status, objective").eq("workspace_id", params.workspaceId).in("campaign_id", c))),
      Promise.all(chunks(adsetIds, CHUNK).map((c) => supabase.from("meta_adsets").select("adset_id, name, effective_status, campaign_id").eq("workspace_id", params.workspaceId).in("adset_id", c))),
      Promise.all(chunks(adIds, CHUNK).map((c) => supabase.from("meta_ads").select("ad_id, name, effective_status, adset_id, campaign_id, creative, thumbnail_path, object_story_id, social_post_id").eq("workspace_id", params.workspaceId).in("ad_id", c))),
    ]);

    const campaignRows = campaigns.flatMap((x) => (x.data ?? []) as Array<{ campaign_id: string; name: string | null; effective_status: string | null; objective: string | null }>);
    const campaignName = new Map<string, string | null>();
    for (const r of campaignRows) {
      campaignName.set(r.campaign_id, r.name);
      data.catalog.campaign[r.campaign_id] = { name: r.name, effectiveStatus: r.effective_status, objective: r.objective };
    }
    const adsetRows = adsets.flatMap((x) => (x.data ?? []) as Array<{ adset_id: string; name: string | null; effective_status: string | null; campaign_id: string | null }>);
    const adRows = ads.flatMap(
      (x) =>
        (x.data ?? []) as Array<{
          ad_id: string;
          name: string | null;
          effective_status: string | null;
          adset_id: string | null;
          campaign_id: string | null;
          creative: Record<string, unknown> | null;
          thumbnail_path: string | null;
          object_story_id: string | null;
          social_post_id: string | null;
        }>,
    );

    // Los nombres de los niveles de arriba que no estan en la tabla (un conjunto o una campaña sin metricas) se piden aparte.
    const missingCampaigns = [...new Set([...adsetRows.map((a) => a.campaign_id), ...adRows.map((a) => a.campaign_id)].filter((id): id is string => !!id && !campaignName.has(id)))];
    for (const c of chunks(missingCampaigns, CHUNK)) {
      const { data: more } = await supabase.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", params.workspaceId).in("campaign_id", c);
      for (const r of (more ?? []) as Array<{ campaign_id: string; name: string | null }>) campaignName.set(r.campaign_id, r.name);
    }

    const adsetName = new Map<string, string | null>();
    for (const r of adsetRows) {
      adsetName.set(r.adset_id, r.name);
      const campaign = r.campaign_id ? (campaignName.get(r.campaign_id) ?? null) : null;
      data.catalog.adset[r.adset_id] = { name: r.name, effectiveStatus: r.effective_status, parentName: campaign, campaignName: campaign };
    }
    const missingAdsets = [...new Set(adRows.map((a) => a.adset_id).filter((id): id is string => !!id && !adsetName.has(id)))];
    for (const c of chunks(missingAdsets, CHUNK)) {
      const { data: more } = await supabase.from("meta_adsets").select("adset_id, name").eq("workspace_id", params.workspaceId).in("adset_id", c);
      for (const r of (more ?? []) as Array<{ adset_id: string; name: string | null }>) adsetName.set(r.adset_id, r.name);
    }

    // Las miniaturas, firmadas de una vez (el bucket es privado; la policy exige dashboards.ads.view).
    const withThumb = adRows.filter((a) => a.thumbnail_path);
    const signed = new Map<string, string>();
    if (withThumb.length > 0) {
      const { data: urls } = await supabase.storage.from("ad-creatives").createSignedUrls(withThumb.map((a) => a.thumbnail_path as string), THUMBNAIL_SECONDS);
      for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }

    // La publicacion que promociona cada anuncio: la de Contenido si esta vinculada, si no la de Facebook que arma su id.
    const socialIds = [...new Set(adRows.map((a) => a.social_post_id).filter((id): id is string => !!id))];
    const socialUrl = new Map<string, string | null>();
    for (const c of chunks(socialIds, CHUNK)) {
      const { data: posts } = await supabase.from("social_posts").select("id, url").eq("workspace_id", params.workspaceId).in("id", c);
      for (const p of (posts ?? []) as Array<{ id: string; url: string | null }>) socialUrl.set(p.id, p.url);
    }

    for (const r of adRows) {
      const title = typeof r.creative?.title === "string" ? r.creative.title : null;
      const adset = r.adset_id ? (adsetName.get(r.adset_id) ?? null) : null;
      data.catalog.ad[r.ad_id] = {
        name: r.name,
        effectiveStatus: r.effective_status,
        parentName: adset,
        adsetName: adset,
        campaignName: r.campaign_id ? (campaignName.get(r.campaign_id) ?? null) : null,
        thumbnailUrl: r.thumbnail_path ? (signed.get(r.thumbnail_path) ?? null) : null,
        creativeTitle: title,
        publicationUrl: publicationUrlOf({ socialPostUrl: r.social_post_id ? socialUrl.get(r.social_post_id) : null, objectStoryId: r.object_story_id }),
      };
    }

    // «# anuncios»: todos los anuncios del catalogo de las campañas y conjuntos que se muestran (no solo los que tuvieron metricas).
    const parentIds = [...new Set([...campaignIds])];
    for (const c of chunks(parentIds, CHUNK)) {
      const { data: links } = await supabase.from("meta_ads").select("ad_id, adset_id, campaign_id").eq("workspace_id", params.workspaceId).in("campaign_id", c);
      for (const l of (links ?? []) as Array<{ ad_id: string; adset_id: string | null; campaign_id: string | null }>) {
        data.adLinks.push({ adId: l.ad_id, adsetId: l.adset_id, campaignId: l.campaign_id });
      }
    }

    // 3. Cuantos toques quedaron sin vincular (el contador que lleva a «Sin vincular»).
    const since90 = new Date((params.now ?? new Date()).getTime() - UNMATCHED_DAYS * 86_400_000).toISOString();
    const { count } = await supabase
      .from("contact_touches")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", params.workspaceId)
      .eq("meta_match_status", "unmatched")
      .gte("occurred_at", since90);
    data.unmatchedCount = count ?? 0;
  } catch (err) {
    // Lo que sea que falle aca no tumba el dashboard: se muestra con lo que haya y avisa.
    console.error("[ads] no pude armar los datos del CRM:", err instanceof Error ? err.message : err);
    data.error = data.error ?? (err instanceof Error ? err.message : "error");
  }

  return data;
}
