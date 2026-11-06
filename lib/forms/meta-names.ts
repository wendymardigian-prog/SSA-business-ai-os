/**
 * Los nombres de campaña, conjunto y anuncio de una respuesta, a partir de los ids que trajo su URL.
 *
 * Los ids pueden venir en su clave propia (`ad_id`) o en un UTM, según cómo estén armados los parámetros del anuncio
 * (`utm_term={{adset.id}}`). Una etiqueta propia, como `utm_content=ad-n6`, no es un id y no se busca.
 *
 * Lee con el cliente de la persona: la RLS del catálogo pide `dashboards.ads.view`, y quien no lo tiene sigue viendo
 * los ids pero no los nombres. Un error deja los nombres vacíos: nunca tumba la tabla ni el CSV.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MetaIds {
  campaign: string | null;
  adset: string | null;
  ad: string | null;
}

export interface MetaRowNames {
  campaign: string | null;
  adset: string | null;
  ad: string | null;
}

export interface MetaNames {
  campaigns: Record<string, string>;
  adsets: Record<string, string>;
  ads: Record<string, string>;
}

export const EMPTY_META_NAMES: MetaNames = { campaigns: {}, adsets: {}, ads: {} };

const META_ID = /^\d{6,}$/;
/** PostgREST manda el `in` en la URL: de a tandas, para que un export grande no la pase de largo. */
const IDS_PER_QUERY = 100;

function firstId(attribution: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = attribution[key];
    if (typeof value === "string" && META_ID.test(value.trim())) return value.trim();
  }
  return null;
}

export function metaIdsFrom(attribution: Record<string, unknown> | null | undefined): MetaIds {
  const a = attribution ?? {};
  return {
    campaign: firstId(a, ["campaign_id", "utm_id", "utm_campaign"]),
    adset: firstId(a, ["adset_id", "utm_term"]),
    ad: firstId(a, ["ad_id", "utm_content"]),
  };
}

export function metaNamesFor(attribution: Record<string, unknown> | null | undefined, names: MetaNames): MetaRowNames {
  const ids = metaIdsFrom(attribution);
  return {
    campaign: ids.campaign ? names.campaigns[ids.campaign] ?? null : null,
    adset: ids.adset ? names.adsets[ids.adset] ?? null : null,
    ad: ids.ad ? names.ads[ids.ad] ?? null : null,
  };
}

type Catalog =
  | { table: "meta_campaigns"; idColumn: "campaign_id" }
  | { table: "meta_adsets"; idColumn: "adset_id" }
  | { table: "meta_ads"; idColumn: "ad_id" };

async function loadCatalog(supabase: SupabaseClient, workspaceId: string, catalog: Catalog, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += IDS_PER_QUERY) {
    const { data, error } = await supabase
      .from(catalog.table)
      .select(`${catalog.idColumn}, name`)
      .eq("workspace_id", workspaceId)
      .in(catalog.idColumn, ids.slice(i, i + IDS_PER_QUERY));
    if (error) {
      console.error("[forms] loadMetaNames fallo, tabla=", catalog.table, "code=", error.code);
      return out;
    }
    for (const row of (data ?? []) as unknown as Array<Record<string, string | null>>) {
      const id = row[catalog.idColumn];
      if (id && row.name) out[id] = row.name;
    }
  }
  return out;
}

export async function loadMetaNames(
  supabase: SupabaseClient,
  workspaceId: string,
  attributions: ReadonlyArray<Record<string, unknown> | null | undefined>,
): Promise<MetaNames> {
  const ids = attributions.map(metaIdsFrom);
  const distinct = (pick: (m: MetaIds) => string | null) => [...new Set(ids.map(pick).filter((v): v is string => !!v))];
  try {
    const [campaigns, adsets, ads] = await Promise.all([
      loadCatalog(supabase, workspaceId, { table: "meta_campaigns", idColumn: "campaign_id" }, distinct((m) => m.campaign)),
      loadCatalog(supabase, workspaceId, { table: "meta_adsets", idColumn: "adset_id" }, distinct((m) => m.adset)),
      loadCatalog(supabase, workspaceId, { table: "meta_ads", idColumn: "ad_id" }, distinct((m) => m.ad)),
    ]);
    return { campaigns, adsets, ads };
  } catch {
    console.error("[forms] loadMetaNames fallo");
    return EMPTY_META_NAMES;
  }
}
