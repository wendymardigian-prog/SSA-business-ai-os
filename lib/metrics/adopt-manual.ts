/**
 * Encontrar el post real de una publicacion marcada a mano (Contenido v4, C3).
 *
 * Cuando alguien sube un video a mano y lo marca como publicado, la fila
 * `manual` no tiene el id que le da la red (`external_post_id`): ese id solo
 * lo conoce la red. Cuando la cuenta esta conectada, la sincronizacion trae
 * ese post. Sin esto lo guardaria como uno nuevo (`external`) y la misma
 * publicacion apareceria dos veces: una en la pieza, sin metricas, y otra
 * suelta, con las metricas.
 *
 * Como se reconoce, en este orden:
 *   1. Por el link: si la persona pego el link al marcarla, y es el mismo
 *      post (normalizado: sin `www.`, sin parametros de tracking, el Reel y
 *      el post de Instagram con el mismo codigo son el mismo).
 *   2. Sin link: si hay UNA sola fila manual sin link de esa red, publicada
 *      a menos de 24 horas del post. Con dos o mas no se adivina: se deja
 *      como esta y se avisa en el log.
 *
 * Puro lo que decide; `findManualMatch` lee la base.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SocialPlatform } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

const WINDOW_MS = 24 * 60 * 60_000;

/** El mismo post, escrito de la misma forma. Null si no es un link. */
export function normalizePostUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const parts = url.pathname.split("/").filter(Boolean);

  // YouTube: youtu.be/ID, /shorts/ID y /watch?v=ID son el mismo video.
  if (host === "youtu.be" && parts[0]) return `youtube:${parts[0]}`;
  if (host === "youtube.com") {
    if (parts[0] === "shorts" && parts[1]) return `youtube:${parts[1]}`;
    const v = url.searchParams.get("v");
    if (v) return `youtube:${v}`;
  }

  // Instagram: /reel/CODE, /reels/CODE y /p/CODE son el mismo post. El
  // codigo distingue mayusculas: no se toca.
  if (host === "instagram.com") {
    const at = parts.findIndex((p) => p === "p" || p === "reel" || p === "reels" || p === "tv");
    if (at >= 0 && parts[at + 1]) return `instagram:${parts[at + 1]}`;
  }

  // El resto: dominio y camino, sin parametros (casi siempre son de rastreo).
  return `${host}/${parts.join("/")}`;
}

export interface ManualCandidate {
  id: string;
  url: string | null;
  published_at: string | null;
}

/** Cual de las filas manuales es este post, o null si no hay una sola segura. */
export function pickManualMatch(
  candidates: ManualCandidate[],
  post: { url: string | null; publishedAt: string | null },
): { id: string | null; ambiguous: boolean } {
  const target = normalizePostUrl(post.url);
  if (target) {
    const byUrl = candidates.filter((c) => normalizePostUrl(c.url) === target);
    if (byUrl.length === 1) return { id: byUrl[0].id, ambiguous: false };
    if (byUrl.length > 1) return { id: null, ambiguous: true };
  }

  if (!post.publishedAt) return { id: null, ambiguous: false };
  const at = new Date(post.publishedAt).getTime();
  if (Number.isNaN(at)) return { id: null, ambiguous: false };

  // Solo las que no tienen link: una con link distinto es OTRO post.
  const near = candidates.filter(
    (c) =>
      !c.url &&
      c.published_at &&
      Math.abs(new Date(c.published_at).getTime() - at) <= WINDOW_MS,
  );
  if (near.length === 1) return { id: near[0].id, ambiguous: false };
  return { id: null, ambiguous: near.length > 1 };
}

/**
 * La fila manual que corresponde a este post, si hay una sola.
 *
 * Busca las manuales de esa red en el workspace todavia sin id externo, de
 * esa cuenta o sin cuenta (una red que se marco antes de conectarla).
 */
export async function findManualMatch(
  supabase: Db,
  params: {
    workspaceId: string;
    socialAccountId: string;
    platform: string;
    url: string | null;
    publishedAt: string | null;
  },
): Promise<string | null> {
  const { data } = await supabase
    .from("social_posts")
    .select("id, url, published_at, social_account_id")
    .eq("workspace_id", params.workspaceId)
    .eq("platform", params.platform as SocialPlatform)
    .eq("origin", "manual")
    .is("external_post_id", null)
    .is("deleted_at", null);

  const candidates = (data ?? []).filter(
    (r) => !r.social_account_id || r.social_account_id === params.socialAccountId,
  ) as ManualCandidate[];
  if (candidates.length === 0) return null;

  const match = pickManualMatch(candidates, { url: params.url, publishedAt: params.publishedAt });
  if (match.ambiguous) {
    console.warn(
      `[metricas] ${candidates.length} publicaciones marcadas a mano en ${params.platform} podrian ser el mismo post: no se adopta ninguna`,
    );
  }
  return match.id;
}
