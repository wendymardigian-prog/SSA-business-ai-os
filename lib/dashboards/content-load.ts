/**
 * Lee de la base lo que dibuja el dashboard de contenido (F48).
 *
 * Una sola pasada por periodo: las filas diarias de posts y cuentas, las
 * publicaciones y el estado de sincronizacion. Las cuentas las hace
 * `lib/dashboards/content.ts`, que es puro y se prueba sin base.
 *
 * Solo lectura, con el cliente del usuario: la RLS decide que ve. Un Member
 * no ve nada de esto hasta el bloque 9, y eso lo aplica la base.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AccountDailyRow, PostDailyRow, PublishedPost } from "./content";
import type { ResolvedPeriod } from "./period";

type Db = SupabaseClient<Database>;

export interface ContentDashboardData {
  posts: PublishedPost[];
  postDaily: PostDailyRow[];
  accountDaily: AccountDailyRow[];
  /** La ultima foto de cada post, para promedios y tabla. */
  latestByPost: Map<string, PostDailyRow>;
  accounts: Array<{ platform: string; syncedAt: string | null; error: string | null }>;
  /** El ultimo dia con dato, por red. */
  lastDataByPlatform: Map<string, string>;
  /** El caption y la miniatura de cada publicacion, para la tabla. */
  postDetails: Map<string, { caption: string | null; thumbnailUrl: string | null }>;
}

const EMPTY: ContentDashboardData = {
  posts: [],
  postDaily: [],
  accountDaily: [],
  latestByPost: new Map(),
  accounts: [],
  lastDataByPlatform: new Map(),
  postDetails: new Map(),
};

/** El rango como fechas `YYYY-MM-DD`, que es como se guardan las filas. */
function dateRange(period: ResolvedPeriod): { from: string | null; to: string | null } {
  return {
    from: period.from ? period.from.slice(0, 10) : null,
    to: period.to ? period.to.slice(0, 10) : null,
  };
}

export async function loadContentDashboard(
  supabase: Db,
  params: { workspaceId: string; period: ResolvedPeriod; platform?: string | null },
): Promise<ContentDashboardData> {
  const { from, to } = dateRange(params.period);

  let postsQuery = supabase
    .from("social_posts")
    .select("id, platform, media_type, published_at, origin, engagement_d7, caption, thumbnail_url")
    .eq("workspace_id", params.workspaceId)
    .is("deleted_at", null)
    .not("published_at", "is", null);

  if (from) postsQuery = postsQuery.gte("published_at", params.period.from as string);
  if (to) postsQuery = postsQuery.lte("published_at", params.period.to as string);
  if (params.platform) postsQuery = postsQuery.eq("platform", params.platform as never);

  const { data: postRows, error } = await postsQuery;
  if (error) {
    console.error("[dashboard] no pude leer las publicaciones:", error.message);
    return EMPTY;
  }

  const posts: PublishedPost[] = (postRows ?? []).map((row) => ({
    socialPostId: row.id,
    platform: row.platform,
    mediaType: row.media_type,
    publishedAt: row.published_at,
    origin: row.origin as "system" | "external",
    engagementD7: row.engagement_d7,
  }));

  const platformById = new Map(posts.map((p) => [p.socialPostId, p.platform]));
  const formatById = new Map(posts.map((p) => [p.socialPostId, p.mediaType]));

  // Las filas diarias de esas publicaciones. Si no hay ninguna, no hace
  // falta la consulta: `.in()` con una lista vacia trae todo.
  let postDaily: PostDailyRow[] = [];
  if (posts.length > 0) {
    let dailyQuery = supabase
      .from("social_post_metrics_daily")
      .select("social_post_id, date, views, impressions, reach, likes, comments, shares, saves, extra")
      .eq("workspace_id", params.workspaceId)
      .in("social_post_id", posts.map((p) => p.socialPostId));

    if (from) dailyQuery = dailyQuery.gte("date", from);
    if (to) dailyQuery = dailyQuery.lte("date", to);

    const { data } = await dailyQuery;
    postDaily = (data ?? []).map((row) => ({
      socialPostId: row.social_post_id,
      platform: platformById.get(row.social_post_id) ?? "",
      mediaType: formatById.get(row.social_post_id) ?? null,
      date: row.date,
      views: row.views,
      impressions: row.impressions,
      reach: row.reach,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
      saves: row.saves,
      extra: row.extra as Record<string, unknown> | null,
    }));
  }

  // La ultima foto de cada post: las metricas son acumuladas, asi que la
  // ultima es el total hasta hoy.
  const latestByPost = new Map<string, PostDailyRow>();
  for (const row of postDaily) {
    const current = latestByPost.get(row.socialPostId);
    if (!current || row.date > current.date) latestByPost.set(row.socialPostId, row);
  }

  const { data: accountRows } = await supabase
    .from("social_accounts")
    .select("id, platform, profile_synced_at, is_active")
    .eq("workspace_id", params.workspaceId)
    .eq("is_active", true);

  const accountIds = (accountRows ?? []).map((a) => a.id);
  const accountPlatform = new Map((accountRows ?? []).map((a) => [a.id, a.platform as string]));

  let accountDaily: AccountDailyRow[] = [];
  if (accountIds.length > 0) {
    let query = supabase
      .from("social_account_metrics_daily")
      .select("social_account_id, date, followers, followers_gained, followers_lost")
      .eq("workspace_id", params.workspaceId)
      .in("social_account_id", accountIds);

    if (from) query = query.gte("date", from);
    if (to) query = query.lte("date", to);

    const { data } = await query;
    accountDaily = (data ?? [])
      .map((row) => ({
        platform: accountPlatform.get(row.social_account_id) ?? "",
        date: row.date,
        followers: row.followers,
        followersGained: row.followers_gained,
        followersLost: row.followers_lost,
      }))
      .filter((row) => !params.platform || row.platform === params.platform);
  }

  const lastDataByPlatform = new Map<string, string>();
  for (const row of [...postDaily, ...accountDaily]) {
    const current = lastDataByPlatform.get(row.platform);
    if (!current || row.date > current) lastDataByPlatform.set(row.platform, row.date);
  }

  return {
    posts,
    postDaily,
    accountDaily,
    latestByPost,
    accounts: (accountRows ?? [])
      .filter((a) => !params.platform || a.platform === params.platform)
      .map((a) => ({
        platform: a.platform as string,
        syncedAt: a.profile_synced_at,
        // El error de la ultima lectura vive en la publicacion que fallo;
        // a nivel cuenta alcanza con saber cuando se actualizo.
        error: null,
      })),
    lastDataByPlatform,
    postDetails: new Map(
      (postRows ?? []).map((row) => [
        row.id,
        { caption: row.caption, thumbnailUrl: row.thumbnail_url },
      ]),
    ),
  };
}
