/**
 * Los nombres del catalogo de Meta para la ficha del contacto (Extra L, AT3, F21).
 *
 * Con el cliente de QUIEN MIRA: las tablas del catalogo y el bucket de miniaturas tienen RLS por
 * `dashboards.ads.view`. Quien no lo tiene recibe vacio y la ficha muestra los ids; nunca falla.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { MetaNames } from "@/lib/contacts/attribution-view";

type Db = SupabaseClient<Database>;

const THUMBNAIL_SECONDS = 3600;
/** Una ficha no necesita miniaturas de mas de unos pocos anuncios: el primero, el ultimo y algunos del camino. */
const MAX_THUMBNAILS = 6;

interface TouchMeta {
  meta_campaign_id?: string | null;
  meta_adset_id?: string | null;
  meta_ad_id?: string | null;
}

export async function loadMetaNames(supabase: Db, workspaceId: string, touches: TouchMeta[]): Promise<MetaNames | undefined> {
  const campaignIds = unique(touches.map((t) => t.meta_campaign_id));
  const adsetIds = unique(touches.map((t) => t.meta_adset_id));
  const adIds = unique(touches.map((t) => t.meta_ad_id));
  if (campaignIds.length + adsetIds.length + adIds.length === 0) return undefined;

  const names: MetaNames = { campaigns: {}, adsets: {}, ads: {} };

  try {
    const [campaigns, adsets, ads] = await Promise.all([
      campaignIds.length > 0
        ? supabase.from("meta_campaigns").select("campaign_id, name").eq("workspace_id", workspaceId).in("campaign_id", campaignIds)
        : null,
      adsetIds.length > 0
        ? supabase.from("meta_adsets").select("adset_id, name").eq("workspace_id", workspaceId).in("adset_id", adsetIds)
        : null,
      adIds.length > 0
        ? supabase.from("meta_ads").select("ad_id, name, thumbnail_path").eq("workspace_id", workspaceId).in("ad_id", adIds)
        : null,
    ]);

    for (const r of (campaigns?.data ?? []) as Array<{ campaign_id: string; name: string | null }>) names.campaigns[r.campaign_id] = r.name;
    for (const r of (adsets?.data ?? []) as Array<{ adset_id: string; name: string | null }>) names.adsets[r.adset_id] = r.name;

    const adRows = (ads?.data ?? []) as Array<{ ad_id: string; name: string | null; thumbnail_path: string | null }>;
    await Promise.all(
      adRows.map(async (r, index) => {
        let thumbnailUrl: string | null = null;
        if (r.thumbnail_path && index < MAX_THUMBNAILS) {
          const { data } = await supabase.storage.from("ad-creatives").createSignedUrl(r.thumbnail_path, THUMBNAIL_SECONDS);
          thumbnailUrl = data?.signedUrl ?? null;
        }
        names.ads[r.ad_id] = { name: r.name, thumbnailUrl };
      }),
    );
  } catch (err) {
    // Un fallo aca no puede romper la ficha: se muestran los ids.
    console.error("[contacts] no pude leer los nombres del catalogo de Meta:", err instanceof Error ? err.message : err);
    return undefined;
  }
  return names;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}
