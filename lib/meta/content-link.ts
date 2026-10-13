/**
 * Enlaza un anuncio con la pieza de Contenido que promociona (Extra L, AT2, F25).
 *
 * Cuando un anuncio promociona una publicacion organica, Meta devuelve el id de esa
 * publicacion (`effective_instagram_media_id`). Si esa publicacion esta en `social_posts`
 * (`external_post_id` igual), el anuncio queda enlazado a ella y, desde ahi, a su pieza
 * (`content_post_id`). Asi el rendimiento pago y el organico de una pieza se pueden ver juntos.
 *
 * Reglas:
 *  - Solo Instagram: es la unica red de Meta que `social_posts` guarda (no hay Facebook).
 *  - **El vinculo automatico no pisa uno manual** (`content_link_manual = true`).
 *  - Sin coincidencia no se escribe nada: un anuncio sin enlace sigue sin enlace.
 *  - Nunca lanza hacia el sync: un fallo aca no puede frenar el catalogo ni las metricas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export interface LinkableAd {
  adId: string;
  instagramMediaId: string | null;
  objectStoryId: string | null;
}

export interface StoredPost {
  id: string;
  externalPostId: string | null;
  contentPostId: string | null;
}

/** Los ids de publicacion que un anuncio puede traer, sin vacios ni repetidos. */
export function candidateIds(ad: LinkableAd): string[] {
  return [...new Set([ad.instagramMediaId, ad.objectStoryId].filter((id): id is string => !!id))];
}

/** La publicacion guardada que corresponde a un anuncio, o null. */
export function matchPost(ad: LinkableAd, posts: StoredPost[]): StoredPost | null {
  const ids = candidateIds(ad);
  if (ids.length === 0) return null;
  return posts.find((post) => post.externalPostId !== null && ids.includes(post.externalPostId)) ?? null;
}

const CHUNK = 200;

/** Devuelve cuantos anuncios quedaron enlazados en esta corrida. */
export async function linkAdsToContent(
  supabase: Db,
  params: { workspaceId: string; adAccountId: string; ads: LinkableAd[] },
): Promise<number> {
  const withIds = params.ads.filter((ad) => candidateIds(ad).length > 0);
  if (withIds.length === 0) return 0;

  try {
    // Los anuncios con enlace manual se dejan como estan.
    const manual = new Set<string>();
    for (let i = 0; i < withIds.length; i += CHUNK) {
      const { data } = await supabase
        .from("meta_ads")
        .select("ad_id")
        .eq("workspace_id", params.workspaceId)
        .eq("ad_account_id", params.adAccountId)
        .eq("content_link_manual", true)
        .in("ad_id", withIds.slice(i, i + CHUNK).map((a) => a.adId));
      for (const row of data ?? []) manual.add(row.ad_id as string);
    }
    const candidates = withIds.filter((ad) => !manual.has(ad.adId));
    if (candidates.length === 0) return 0;

    const wanted = [...new Set(candidates.flatMap(candidateIds))];
    const posts: StoredPost[] = [];
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const { data } = await supabase
        .from("social_posts")
        .select("id, external_post_id, content_post_id")
        .eq("workspace_id", params.workspaceId)
        .eq("platform", "instagram")
        .in("external_post_id", wanted.slice(i, i + CHUNK));
      for (const row of data ?? []) {
        posts.push({
          id: row.id as string,
          externalPostId: (row.external_post_id as string | null) ?? null,
          contentPostId: (row.content_post_id as string | null) ?? null,
        });
      }
    }

    let linked = 0;
    for (const ad of candidates) {
      const post = matchPost(ad, posts);
      if (!post) continue;
      const { error } = await supabase
        .from("meta_ads")
        .update({ social_post_id: post.id, content_post_id: post.contentPostId } as never)
        .eq("workspace_id", params.workspaceId)
        .eq("ad_account_id", params.adAccountId)
        .eq("ad_id", ad.adId)
        .eq("content_link_manual", false);
      if (!error) linked += 1;
    }
    return linked;
  } catch (err) {
    console.error("[meta-ads] no pude enlazar los anuncios con Contenido:", err instanceof Error ? err.message : err);
    return 0;
  }
}
