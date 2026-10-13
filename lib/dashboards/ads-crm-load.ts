/**
 * Lo que la tabla «Meta vs CRM» necesita ademas de las metricas de Meta (Extra L, AT4, F31).
 *
 * Todo con el cliente de QUIEN MIRA: `ads_crm_metrics` es SECURITY INVOKER (la RLS decide que contactos,
 * agendas y ventas cuenta), y el catalogo y las miniaturas tienen RLS por `dashboards.ads.view`.
 * **Nada de esto puede tumbar el dashboard**: si algo falla, la tabla se ve con lo de Meta y avisa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { CatalogEntry, CrmLevel, CrmMetrics } from "./ads-crm";

type Db = SupabaseClient<Database>;

export interface CrmTableData {
  metrics: Record<CrmLevel, CrmMetrics[]>;
  catalog: Record<CrmLevel, Record<string, CatalogEntry>>;
  /** Toques sin vincular de los ultimos 90 dias (los mismos que lista «Sin vincular»). */
  unmatchedCount: number;
  /** Quien mira no ve todos los leads: la tabla cuenta solo los de su alcance. */
  scopeLimited: boolean;
  /** El rango pedido (fechas civiles), para el nombre del CSV. */
  since: string;
  until: string;
  /** Si `ads_crm_metrics` fallo, el motivo (la tabla se muestra igual, sin el CRM). */
  error: string | null;
}

export const EMPTY_CRM: CrmTableData = {
  metrics: { campaign: [], adset: [], ad: [] },
  catalog: { campaign: {}, adset: {}, ad: {} },
  unmatchedCount: 0,
  scopeLimited: false,
  since: "",
  until: "",
  error: null,
};

const LEVELS: CrmLevel[] = ["campaign", "adset", "ad"];
const CHUNK = 200;
const THUMBNAIL_SECONDS = 3600;
const UNMATCHED_DAYS = 90;

interface RpcRow {
  object_id: string;
  leads_first: number;
  leads_total: number;
  leads_with_booking: number;
  bookings: number;
  bookings_attended: number;
  sales: number;
  revenue_cents: number | string;
  cash_cents: number | string;
}

/** Los `bigint` de la base llegan como numero o como texto: se pasan a numero sin confiar. */
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function mapMetrics(rows: RpcRow[] | null | undefined): CrmMetrics[] {
  return (rows ?? []).map((r) => ({
    objectId: r.object_id,
    leadsFirst: num(r.leads_first),
    leadsTotal: num(r.leads_total),
    leadsWithBooking: num(r.leads_with_booking),
    bookings: num(r.bookings),
    bookingsAttended: num(r.bookings_attended),
    sales: num(r.sales),
    revenueCents: num(r.revenue_cents),
    cashCents: num(r.cash_cents),
  }));
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
    catalog: { campaign: {}, adset: {}, ad: {} },
    since: params.since,
    until: params.until,
    scopeLimited: params.scopeLimited,
  };

  try {
    // 1. El CRM, por nivel. Cada uno por su cuenta: si uno falla, los otros se muestran.
    const results = await Promise.all(
      LEVELS.map((level) =>
        supabase.rpc("ads_crm_metrics", {
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
        data.metrics[LEVELS[index]] = mapMetrics(result.data as unknown as RpcRow[]);
      }
    });

    // 2. El catalogo (nombre, estado, padre y miniatura) de todo lo que va a aparecer en la tabla.
    const ids = (level: CrmLevel) => [...new Set([...params.objectIds[level], ...data.metrics[level].map((m) => m.objectId)])];

    const campaignIds = ids("campaign");
    const adsetIds = ids("adset");
    const adIds = ids("ad");

    const [campaigns, adsets, ads] = await Promise.all([
      Promise.all(chunks(campaignIds, CHUNK).map((c) => supabase.from("meta_campaigns").select("campaign_id, name, effective_status").eq("workspace_id", params.workspaceId).in("campaign_id", c))),
      Promise.all(chunks(adsetIds, CHUNK).map((c) => supabase.from("meta_adsets").select("adset_id, name, effective_status, campaign_id").eq("workspace_id", params.workspaceId).in("adset_id", c))),
      Promise.all(chunks(adIds, CHUNK).map((c) => supabase.from("meta_ads").select("ad_id, name, effective_status, adset_id, creative, thumbnail_path").eq("workspace_id", params.workspaceId).in("ad_id", c))),
    ]);

    const campaignName = new Map<string, string | null>();
    for (const r of campaigns.flatMap((x) => (x.data ?? []) as Array<{ campaign_id: string; name: string | null; effective_status: string | null }>)) {
      campaignName.set(r.campaign_id, r.name);
      data.catalog.campaign[r.campaign_id] = { name: r.name, effectiveStatus: r.effective_status };
    }
    const adsetRows = adsets.flatMap((x) => (x.data ?? []) as Array<{ adset_id: string; name: string | null; effective_status: string | null; campaign_id: string | null }>);
    const adsetName = new Map<string, string | null>();
    for (const r of adsetRows) {
      adsetName.set(r.adset_id, r.name);
      data.catalog.adset[r.adset_id] = { name: r.name, effectiveStatus: r.effective_status, parentName: r.campaign_id ? (campaignName.get(r.campaign_id) ?? null) : null };
    }

    const adRows = ads.flatMap((x) => (x.data ?? []) as Array<{ ad_id: string; name: string | null; effective_status: string | null; adset_id: string | null; creative: Record<string, unknown> | null; thumbnail_path: string | null }>);
    // El nombre del conjunto de un anuncio puede ser de un conjunto que no esta en la tabla: se pide aparte.
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
    for (const r of adRows) {
      const title = typeof r.creative?.title === "string" ? r.creative.title : null;
      data.catalog.ad[r.ad_id] = {
        name: r.name,
        effectiveStatus: r.effective_status,
        parentName: r.adset_id ? (adsetName.get(r.adset_id) ?? null) : null,
        thumbnailUrl: r.thumbnail_path ? (signed.get(r.thumbnail_path) ?? null) : null,
        creativeTitle: title,
      };
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
