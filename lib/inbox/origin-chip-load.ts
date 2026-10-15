/**
 * Resuelve los chips "Vino de…" de un hilo (Extra I, F44).
 *
 * UNA consulta por tabla por hilo (publicaciones, piezas, anuncios), nunca una por mensaje, y con el cliente de la
 * SESION: la RLS decide que titulos ve cada persona. Los anuncios solo se piden si quien mira puede ver el dashboard de
 * anuncios (`dashboards.ads.view`): sin ese permiso no se lee el catalogo ni se linkea.
 *
 * NUNCA lanza: si una consulta falla se loguea (sin datos sensibles) y los chips salen con lo que trae el propio
 * mensaje. Un hilo sin chips es mejor que un hilo que no abre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChipMessage } from "@/lib/messages/origin-view";
import { originChipViews, originRefsFor, type OriginChipView, type OriginLookup } from "./origin-chip";

/** El tope de una lista dentro de un `in (...)`: un hilo largo no arma una URL gigante. */
const MAX_IDS = 100;

export async function loadOriginChips(
  supabase: SupabaseClient,
  params: { workspaceId: string; messages: readonly ChipMessage[]; canSeeAds: boolean },
): Promise<Record<string, OriginChipView>> {
  try {
    const refs = originRefsFor(params.messages);
    if (refs.contentPostIds.length === 0 && refs.socialPostIds.length === 0 && refs.adIds.length === 0) return {};

    const socialPosts = new Map<string, { contentPostId: string | null; caption: string | null; mediaType: string | null }>();
    if (refs.socialPostIds.length > 0) {
      const { data, error } = await supabase
        .from("social_posts")
        .select("id, content_post_id, caption, media_type")
        .eq("workspace_id", params.workspaceId)
        .in("id", refs.socialPostIds.slice(0, MAX_IDS));
      if (error) console.error("[inbox] no pude leer las publicaciones de los chips:", error.message);
      for (const row of (data ?? []) as Array<{ id: string; content_post_id: string | null; caption: string | null; media_type: string | null }>) {
        socialPosts.set(row.id, { contentPostId: row.content_post_id, caption: row.caption, mediaType: row.media_type });
      }
    }

    // Las piezas: las que trae el mensaje y las de las publicaciones recien leidas.
    const pieceIds = new Set(refs.contentPostIds);
    for (const post of socialPosts.values()) if (post.contentPostId) pieceIds.add(post.contentPostId);

    const pieces = new Map<string, { title: string | null; format: string | null }>();
    const adsQuery =
      params.canSeeAds && refs.adIds.length > 0
        ? supabase
            .from("meta_ads")
            .select("ad_id, ad_account_id, name")
            .eq("workspace_id", params.workspaceId)
            .in("ad_id", refs.adIds.slice(0, MAX_IDS))
        : null;
    const piecesQuery =
      pieceIds.size > 0
        ? supabase
            .from("content_posts")
            .select("id, title, format")
            .eq("workspace_id", params.workspaceId)
            .in("id", [...pieceIds].slice(0, MAX_IDS))
        : null;

    const [piecesRes, adsRes] = await Promise.all([piecesQuery, adsQuery]);
    if (piecesRes?.error) console.error("[inbox] no pude leer las piezas de los chips:", piecesRes.error.message);
    for (const row of (piecesRes?.data ?? []) as Array<{ id: string; title: string | null; format: string | null }>) {
      pieces.set(row.id, { title: row.title, format: row.format });
    }

    const ads = new Map<string, { adAccountId: string; name: string | null }>();
    if (adsRes?.error) console.error("[inbox] no pude leer los anuncios de los chips:", adsRes.error.message);
    for (const row of (adsRes?.data ?? []) as Array<{ ad_id: string; ad_account_id: string; name: string | null }>) {
      ads.set(row.ad_id, { adAccountId: row.ad_account_id, name: row.name });
    }

    const lookup: OriginLookup = { pieces, socialPosts, ads };
    return originChipViews(params.messages, lookup, { canSeeAds: params.canSeeAds });
  } catch (error) {
    console.error("[inbox] no pude armar los chips de origen:", error instanceof Error ? error.message : "error");
    return {};
  }
}

/** Suma `origin_chip` a cada mensaje que lo lleva (los demas quedan como estaban). */
export function withOriginChips<T extends { id: string }>(messages: readonly T[], chips: Record<string, OriginChipView>): Array<T & { origin_chip?: OriginChipView }> {
  return messages.map((message) => (chips[message.id] ? { ...message, origin_chip: chips[message.id] } : message));
}
