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
import {
  matchesClassification,
  type AccountDailyRow,
  type ClassificationFilters,
  type PieceInfo,
  type PostDailyRow,
  type PublishedPost,
} from "./content";
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
  /** La pieza de cada publicacion que salio del sistema (F105). */
  pieces: Map<string, PieceInfo>;
  /** Contactos que llegaron por comentario, por publicacion (F104). Null si no se pudo leer. */
  leadsByPost: Map<string, number> | null;
  /**
   * Lo que se puede elegir en los filtros: sale de TODAS las publicaciones del
   * periodo, no de las que sobreviven al filtro. Si no, al elegir una oferta
   * las demas desaparecerian de la lista y no habria como cambiar.
   */
  filterOptions: FilterOptions;
}

export interface FilterOptions {
  pieces: Array<{ id: string; title: string }>;
  offers: Array<{ id: string; name: string }>;
  pillars: Array<{ id: string; name: string }>;
  formats: string[];
}

const EMPTY_OPTIONS: FilterOptions = { pieces: [], offers: [], pillars: [], formats: [] };

const EMPTY: ContentDashboardData = {
  posts: [],
  postDaily: [],
  accountDaily: [],
  latestByPost: new Map(),
  accounts: [],
  lastDataByPlatform: new Map(),
  postDetails: new Map(),
  pieces: new Map(),
  leadsByPost: null,
  filterOptions: EMPTY_OPTIONS,
};

/** El rango como fechas `YYYY-MM-DD`, que es como se guardan las filas. */
function dateRange(period: ResolvedPeriod): { from: string | null; to: string | null } {
  return {
    from: period.from ? period.from.slice(0, 10) : null,
    to: period.to ? period.to.slice(0, 10) : null,
  };
}

/** Un `.in()` con cientos de ids pasa el largo que aguanta una URL: se pide de a tandas. */
const IN_CHUNK = 100;

/**
 * Las piezas de las publicaciones, con los nombres de su oferta y su pilar.
 *
 * Los archivados tambien: una publicacion vieja sigue siendo de la oferta que
 * despues se archivo, y mostrarla como "Sin asignar" seria mentir sobre ella.
 */
async function loadPieces(supabase: Db, workspaceId: string, pieceIds: string[]): Promise<Map<string, PieceInfo>> {
  const pieces = new Map<string, PieceInfo>();
  if (pieceIds.length === 0) return pieces;

  const rows: Array<{
    id: string;
    title: string;
    offer_id: string | null;
    pillar_id: string | null;
    funnel_stage: string | null;
  }> = [];
  for (let i = 0; i < pieceIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("content_posts")
      .select("id, title, offer_id, pillar_id, funnel_stage")
      .eq("workspace_id", workspaceId)
      .in("id", pieceIds.slice(i, i + IN_CHUNK));
    if (error) {
      console.error("[dashboard] no pude leer las piezas:", error.message);
      return pieces;
    }
    rows.push(...(data ?? []));
  }

  const offerIds = [...new Set(rows.map((r) => r.offer_id).filter((v): v is string => v !== null))];
  const pillarIds = [...new Set(rows.map((r) => r.pillar_id).filter((v): v is string => v !== null))];

  const [offers, pillars] = await Promise.all([
    offerIds.length > 0
      ? supabase.from("content_offers").select("id, name").eq("workspace_id", workspaceId).in("id", offerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    pillarIds.length > 0
      ? supabase.from("content_pillars").select("id, name").eq("workspace_id", workspaceId).in("id", pillarIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);

  const offerName = new Map((offers.data ?? []).map((o) => [o.id, o.name]));
  const pillarName = new Map((pillars.data ?? []).map((p) => [p.id, p.name]));

  for (const row of rows) {
    pieces.set(row.id, {
      id: row.id,
      title: row.title,
      offerId: row.offer_id,
      offerName: row.offer_id ? (offerName.get(row.offer_id) ?? null) : null,
      pillarId: row.pillar_id,
      pillarName: row.pillar_id ? (pillarName.get(row.pillar_id) ?? null) : null,
      funnelStage: row.funnel_stage,
    });
  }
  return pieces;
}

/**
 * Cuantos contactos llegaron por comentario a cada publicacion (F104): los que
 * tienen un comentario en esa publicacion como PRIMER toque.
 *
 * Con el cliente de quien mira: un Member solo cuenta los contactos que ve.
 * Si falla, devuelve null y la columna queda en hueco, no en cero.
 */
async function loadLeadsByPost(supabase: Db, postIds: string[]): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  if (postIds.length === 0) return counts;

  for (let i = 0; i < postIds.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from("contacts")
      .select("origin:attribution->first_touch->>origin, post:attribution->first_touch->>social_post_id")
      .is("deleted_at", null)
      .eq("attribution->first_touch->>origin", "comment")
      .in("attribution->first_touch->>social_post_id", postIds.slice(i, i + IN_CHUNK))
      .limit(5000);

    if (error) {
      console.error("[dashboard] no pude leer los leads por publicacion:", error.message);
      return null;
    }
    for (const row of (data ?? []) as unknown as Array<{ post: string | null }>) {
      if (row.post) counts.set(row.post, (counts.get(row.post) ?? 0) + 1);
    }
  }
  return counts;
}

export async function loadContentDashboard(
  supabase: Db,
  params: {
    workspaceId: string;
    period: ResolvedPeriod;
    platform?: string | null;
    /** Filtros sobre la clasificacion de la pieza y el formato (F105). */
    filters?: ClassificationFilters;
  },
): Promise<ContentDashboardData> {
  const { from, to } = dateRange(params.period);

  let postsQuery = supabase
    .from("social_posts")
    .select(
      "id, platform, media_type, published_at, origin, engagement_d7, caption, thumbnail_url, content_post_id",
    )
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

  const allPosts: PublishedPost[] = (postRows ?? []).map((row) => ({
    socialPostId: row.id,
    platform: row.platform,
    mediaType: row.media_type,
    publishedAt: row.published_at,
    origin: row.origin as "system" | "external",
    engagementD7: row.engagement_d7,
    contentPostId: row.content_post_id,
  }));

  // La clasificacion vive en la pieza, no en la publicacion: se lee aparte y se
  // filtra en memoria, que es poco (las publicaciones de un periodo).
  const pieceIds = [...new Set(allPosts.map((p) => p.contentPostId).filter((v): v is string => !!v))];
  const pieces = await loadPieces(supabase, params.workspaceId, pieceIds);

  const filterOptions: FilterOptions = {
    pieces: [...pieces.values()]
      .map((p) => ({ id: p.id, title: p.title.trim() || "Sin título" }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    offers: uniqueNamed([...pieces.values()].map((p) => ({ id: p.offerId, name: p.offerName }))),
    pillars: uniqueNamed([...pieces.values()].map((p) => ({ id: p.pillarId, name: p.pillarName }))),
    formats: [...new Set(allPosts.map((p) => p.mediaType).filter((v): v is NonNullable<typeof v> => v !== null))].sort(),
  };

  const filters = params.filters ?? {};
  const posts = allPosts.filter((post) => matchesClassification(post, pieces, filters));

  const leadsByPost = await loadLeadsByPost(
    supabase,
    posts.map((p) => p.socialPostId),
  );

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
    pieces,
    leadsByPost,
    filterOptions,
  };
}

/** Las ofertas o pilares distintos que tienen nombre, ordenados. */
function uniqueNamed(items: Array<{ id: string | null; name: string | null }>): Array<{ id: string; name: string }> {
  const byId = new Map<string, string>();
  for (const item of items) {
    if (item.id) byId.set(item.id, item.name ?? "Archivado");
  }
  return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
