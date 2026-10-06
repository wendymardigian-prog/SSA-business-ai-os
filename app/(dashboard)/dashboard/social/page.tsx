import { requirePermission } from "@/lib/auth/guards";
import { SocialView, type SocialTile } from "@/components/social/social-view";
import type { ProfileSource } from "@/lib/social/profile-page";

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
 * Las historias en vivo (Instagram) llegan con el bloque siguiente.
 */
export default async function SocialPage() {
  const { workspace, supabase, role } = await requirePermission("social.view");

  const { data: accounts } = await supabase
    .from("social_accounts")
    .select("id, platform, username, display_name, bio, website, avatar_url, profile_synced_at")
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
          .select("social_account_id, date, followers")
          .in("social_account_id", accountIds)
          .gte("date", since)
          .order("date")
      : Promise.resolve({ data: [] as Array<{ social_account_id: string; date: string; followers: number | null }> }),
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

  const profiles: Record<string, ProfileSource> = {};
  for (const account of accounts ?? []) {
    const platform = account.platform as string;
    const points = followerPoints[platform] ?? [];
    const lastFollowers = [...points].reverse().find((p) => p.followers !== null)?.followers ?? null;

    profiles[platform] = {
      platform,
      username: account.username,
      displayName: account.display_name,
      bio: account.bio,
      website: account.website,
      avatarUrl: account.avatar_url,
      followers: lastFollowers,
      // Seguidos, vistas totales y me gusta totales todavia no se guardan:
      // ninguna recoleccion los trae. Mostrar un cero diria que no hay.
      following: null,
      posts: (postRows ?? []).filter((p) => p.platform === platform).length,
      totalOther: null,
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

  return (
    <SocialView
      platforms={platforms}
      profiles={profiles}
      tiles={tiles}
      followerPoints={followerPoints}
      canRefresh={role === "owner" || role === "admin"}
    />
  );
}
