import { requirePermission } from "@/lib/auth/guards";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { SocialView, type SocialTile } from "@/components/social/social-view";
import {
  SOCIAL_PLATFORMS,
  buildUpcoming,
  latestProfileStats,
  type LinkedinSource,
  type ProfileSource,
  type UpcomingItem,
} from "@/lib/social/profile-page";

export const dynamic = "force-dynamic";

/**
 * La pagina Social (F54).
 *
 * El perfil de cada red conectada y su grilla de publicaciones, con las
 * metricas que la red no muestra. Pide el permiso `social.view` (F78): Owner y
 * Admin lo tienen siempre, y un rol personalizado se lo puede dar a un Member.
 * Las tablas de metricas lo dejan leer por la misma clave (00113).
 *
 * Todo sale de lo que ya se recolecto: esta pantalla no llama a ninguna API.
 * Las historias de Instagram quedan afuera (F100): dependen del token de Meta.
 *
 * El perfil muestra las cifras reales que lee la sincronizacion (F75): foto,
 * usuario, bio, link, seguidores, seguidos, publicaciones. Arriba de la grilla
 * van las "Proximas" (lo programado y lo tentativo), y cada red sin conectar
 * invita a conectarla. LinkedIn es una lista: no entrega metricas.
 */
export default async function SocialPage() {
  const { workspace, supabase, role } = await requirePermission("social.view");

  const { data: accounts } = await supabase
    .from("social_accounts")
    .select("id, platform, username, display_name, bio, website, avatar_url, profile_synced_at, profile_sync_error")
    .eq("workspace_id", workspace.id)
    .eq("is_active", true)
    .order("platform");

  const platforms = (accounts ?? []).map((a) => a.platform as string);
  const accountIds = (accounts ?? []).map((a) => a.id);

  // Los ultimos 30 dias de seguidores, para el mini grafico de tendencia.
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: followerRows }, { data: postRows }] = await Promise.all([
    accountIds.length > 0
      ? supabase
          .from("social_account_metrics_daily")
          .select("social_account_id, date, followers, extra")
          .in("social_account_id", accountIds)
          .gte("date", since)
          .order("date")
      : Promise.resolve({
          data: [] as Array<{ social_account_id: string; date: string; followers: number | null; extra: unknown }>,
        }),
    supabase
      .from("social_posts")
      .select("id, platform, media_type, thumbnail_url, caption, url, published_at, origin")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(120),
  ]);

  const postIds = (postRows ?? []).map((p) => p.id);

  // La ultima foto de cada publicacion, para las metricas de la baldosa.
  const { data: metricRows } = postIds.length > 0
    ? await supabase
        .from("social_post_metrics_daily")
        .select("social_post_id, date, views, reach, likes, comments, shares, saves")
        .in("social_post_id", postIds)
        .order("date")
    : { data: [] };

  interface Snapshot {
    views: number | null;
    reach: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  }

  // Ordenadas por fecha, asi que la ultima que se escribe es la mas nueva.
  const latest = new Map<string, Snapshot>();
  for (const row of metricRows ?? []) latest.set(row.social_post_id, row);

  const platformById = new Map((accounts ?? []).map((a) => [a.id, a.platform as string]));

  const followerPoints: Record<string, Array<{ date: string; followers: number | null }>> = {};
  for (const row of followerRows ?? []) {
    const platform = platformById.get(row.social_account_id);
    if (!platform) continue;
    (followerPoints[platform] ??= []).push({ date: row.date, followers: row.followers });
  }

  // Las cifras de perfil que no son una serie (seguidos, publicaciones, videos,
  // vistas, me gusta): salen del `extra` de la lectura diaria (F75).
  const extraByPlatform: Record<string, Array<{ date: string; extra: unknown }>> = {};
  for (const row of followerRows ?? []) {
    const platform = platformById.get(row.social_account_id);
    if (!platform) continue;
    (extraByPlatform[platform] ??= []).push({ date: row.date, extra: row.extra });
  }

  const profiles: Record<string, ProfileSource> = {};
  for (const account of accounts ?? []) {
    const platform = account.platform as string;
    const points = followerPoints[platform] ?? [];
    const lastFollowers = [...points].reverse().find((p) => p.followers !== null)?.followers ?? null;
    const figures = latestProfileStats(extraByPlatform[platform] ?? []);

    profiles[platform] = {
      platform,
      username: account.username,
      displayName: account.display_name,
      bio: account.bio,
      website: account.website,
      avatarUrl: account.avatar_url,
      followers: lastFollowers,
      // Lo que la red dio de verdad. Lo que no dio queda en null y se muestra
      // como "—": un cero diria que la cuenta no tiene nada.
      following: figures.following,
      posts: figures.posts,
      videos: figures.videos,
      totalOther: platform === "youtube" ? figures.views : platform === "tiktok" ? figures.likes : null,
      syncError: account.profile_sync_error,
      syncedAt: account.profile_synced_at,
    };
  }

  const tiles: SocialTile[] = (postRows ?? []).map((post) => {
    const row = latest.get(post.id);
    const interactions = [row?.likes, row?.comments, row?.shares, row?.saves].filter(
      (v): v is number => typeof v === "number",
    );
    const denominator = row?.reach ?? row?.views ?? null;

    return {
      socialPostId: post.id,
      platform: post.platform,
      mediaType: post.media_type,
      thumbnailUrl: post.thumbnail_url,
      caption: post.caption,
      url: post.url,
      publishedAt: post.published_at,
      origin: post.origin as "system" | "external",
      views: row?.views ?? null,
      reach: row?.reach ?? null,
      likes: row?.likes ?? null,
      comments: row?.comments ?? null,
      shares: row?.shares ?? null,
      saves: row?.saves ?? null,
      engagement:
        interactions.length > 0 && denominator !== null && denominator > 0
          ? Number(((interactions.reduce((a, b) => a + b, 0) / denominator) * 100).toFixed(2))
          : null,
    };
  });

  // "Proximas": lo programado y lo tentativo de cada red. Las piezas con su
  // fecha planeada (jsonb) y lo que ya esta en la cola.
  const [{ data: pieceRows }, { data: queueRows }, { data: linkedinRowsRaw }] = await Promise.all([
    supabase
      .from("content_posts")
      .select("id, title, format, status, networks, archived_at")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase
      .from("social_posts")
      .select("content_post_id, platform, status, scheduled_at")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .not("content_post_id", "is", null)
      .limit(1000),
    // LinkedIn no entrega metricas: se muestra lo publicado desde el sistema.
    supabase
      .from("social_posts")
      .select("id, content_post_id, caption, status, published_at, scheduled_at, url, last_error")
      .eq("workspace_id", workspace.id)
      .eq("platform", "linkedin")
      .eq("origin", "system")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const now = new Date();
  const upcoming: Record<string, UpcomingItem[]> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    upcoming[platform] = buildUpcoming({
      posts: (pieceRows ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        format: p.format,
        status: p.status,
        networks: (Array.isArray(p.networks) ? p.networks : []) as Array<{ platform?: string; planned_at?: string | null }>,
        archivedAt: p.archived_at,
      })),
      publications: (queueRows ?? []).map((q) => ({
        contentPostId: q.content_post_id as string,
        platform: q.platform,
        status: q.status,
        scheduledAt: q.scheduled_at,
      })),
      platform,
      now,
    });
  }

  const timeZone = await resolveViewerTimezone(workspace.timezone);

  const linkedin: LinkedinSource[] = (linkedinRowsRaw ?? []).map((r) => ({
    socialPostId: r.id,
    contentPostId: r.content_post_id,
    caption: r.caption,
    status: r.status,
    publishedAt: r.published_at,
    scheduledAt: r.scheduled_at,
    url: r.url,
    lastError: r.last_error,
  }));

  return (
    <SocialView
      platforms={platforms}
      profiles={profiles}
      tiles={tiles}
      followerPoints={followerPoints}
      upcoming={upcoming}
      linkedin={linkedin}
      canRefresh={role === "owner" || role === "admin"}
      canConnect={role === "owner" || role === "admin"}
      timeZone={timeZone}
    />
  );
}
