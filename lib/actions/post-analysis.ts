"use server";

import { getPermissionContext } from "@/lib/auth/guards";
import { workspaceDate } from "@/lib/metrics/rules";
import {
  benchmark,
  evolution,
  metricCards,
  reachAudience,
  type AnalysisMetric,
  type Snapshot,
} from "@/lib/dashboards/post-analysis";
import { computeFollowerBump, neighborPosts } from "@/lib/dashboards/follower-bump";
import { daysBetween } from "@/lib/metrics/rules";
import { resolveViewerTimezone } from "@/lib/user-timezone";

/**
 * Los datos del panel de analisis de un post (F51, F52).
 *
 * Se carga cuando se abre el panel y no con el dashboard: son cinco
 * consultas por post, y el dashboard muestra cincuenta. Cargarlas todas de
 * entrada haria que la pantalla tarde para mostrar algo que casi nadie abre.
 */

export interface PostAnalysis {
  post: {
    id: string;
    platform: string;
    mediaType: string | null;
    publishedAt: string | null;
    origin: "system" | "external";
    url: string | null;
    caption: string | null;
    thumbnailUrl: string | null;
    contentPostId: string | null;
  };
  cards: ReturnType<typeof metricCards>;
  evolution: ReturnType<typeof evolution>;
  benchmark: Array<{ day: number; value: number | null }>;
  audience: ReturnType<typeof reachAudience>;
  bump: ReturnType<typeof computeFollowerBump>;
  neighbors: Array<{ socialPostId: string; platform: string; publishedAt: string | null; caption: string | null }>;
  comments: Array<{
    id: string;
    authorUsername: string | null;
    text: string | null;
    commentedAt: string | null;
    isOwn: boolean;
  }>;
  metric: AnalysisMetric;
}

export type AnalysisResult = { ok: true; data: PostAnalysis } | { ok: false; error: string };

export async function loadPostAnalysis(input: {
  socialPostId: string;
  metric?: AnalysisMetric;
}): Promise<AnalysisResult> {
  // Se abre desde Social y desde el dashboard de contenido: alcanza con poder
  // ver cualquiera de los dos (F78). Solo lee lo que la base ya deja leer.
  const ctx = await getPermissionContext();
  if (!ctx.can("social.view") && !ctx.can("dashboards.content.view")) {
    return { ok: false, error: "No tenes permiso para ver el analisis de las publicaciones" };
  }
  const { workspace, supabase } = ctx;
  const metric: AnalysisMetric = input.metric ?? "views";

  const { data: post } = await supabase
    .from("social_posts")
    .select(
      "id, platform, media_type, published_at, origin, url, caption, thumbnail_url, content_post_id, social_account_id, engagement_d7",
    )
    .eq("id", input.socialPostId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa publicacion" };

  const now = new Date();
  const timeZone = await resolveViewerTimezone(workspace.timezone);

  const { data: snapshotRows } = await supabase
    .from("social_post_metrics_daily")
    .select("date, views, reach, likes, comments, shares, saves, extra")
    .eq("social_post_id", post.id)
    .order("date");

  const snapshots: Snapshot[] = (snapshotRows ?? []).map((row) => ({
    date: row.date,
    views: row.views,
    reach: row.reach,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    saves: row.saves,
    extra: row.extra as Record<string, unknown> | null,
  }));

  const latest = snapshots.at(-1) ?? null;
  const points = evolution({ publishedAt: post.published_at ?? "", snapshots, metric });
  const maxDay = points.at(-1)?.day ?? 0;

  // Los comparables: misma red y mismo formato, sin contar este.
  const { data: peerRows } = await supabase
    .from("social_posts")
    .select("id, published_at")
    .eq("workspace_id", workspace.id)
    .eq("platform", post.platform)
    .eq("media_type", post.media_type as never)
    .neq("id", post.id)
    .not("published_at", "is", null)
    .is("deleted_at", null)
    .order("published_at", { ascending: false })
    .limit(20);

  const peerIds = (peerRows ?? []).map((p) => p.id);
  const peerSnapshots = new Map<string, Snapshot[]>();

  if (peerIds.length > 0) {
    const { data: peerDaily } = await supabase
      .from("social_post_metrics_daily")
      .select("social_post_id, date, views, reach, likes, comments, shares, saves")
      .in("social_post_id", peerIds);

    for (const row of peerDaily ?? []) {
      const list = peerSnapshots.get(row.social_post_id) ?? [];
      list.push({
        date: row.date,
        views: row.views,
        reach: row.reach,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        saves: row.saves,
      });
      peerSnapshots.set(row.social_post_id, list);
    }
  }

  // El salto de seguidores: la serie de la cuenta alrededor de la fecha.
  const publishedDate = post.published_at
    ? workspaceDate(new Date(post.published_at), timeZone)
    : null;

  let bump = computeFollowerBump({
    platform: post.platform,
    publishedDate: publishedDate ?? "",
    points: [],
    today: workspaceDate(now, timeZone),
  });
  let neighbors: PostAnalysis["neighbors"] = [];

  if (publishedDate && post.social_account_id) {
    const { data: followerRows } = await supabase
      .from("social_account_metrics_daily")
      .select("date, followers")
      .eq("social_account_id", post.social_account_id)
      .order("date");

    bump = computeFollowerBump({
      platform: post.platform,
      publishedDate,
      points: (followerRows ?? []).map((r) => ({ date: r.date, followers: r.followers })),
      today: workspaceDate(now, timeZone),
    });

    const { data: sameDays } = await supabase
      .from("social_posts")
      .select("id, platform, published_at, caption")
      .eq("workspace_id", workspace.id)
      .eq("platform", post.platform)
      .is("deleted_at", null)
      .not("published_at", "is", null);

    neighbors = neighborPosts(
      (sameDays ?? []).map((p) => ({
        socialPostId: p.id,
        platform: p.platform,
        publishedAt: p.published_at,
        caption: p.caption,
      })),
      { socialPostId: post.id, platform: post.platform, publishedDate },
    );
  }

  const { data: commentRows } = await supabase
    .from("social_post_comments")
    .select("id, author_username, text, commented_at, is_own")
    .eq("social_post_id", post.id)
    .is("deleted_at", null)
    .order("commented_at", { ascending: false })
    .limit(10);

  return {
    ok: true,
    data: {
      post: {
        id: post.id,
        platform: post.platform,
        mediaType: post.media_type,
        publishedAt: post.published_at,
        origin: post.origin as "system" | "external",
        url: post.url,
        caption: post.caption,
        thumbnailUrl: post.thumbnail_url,
        contentPostId: post.content_post_id,
      },
      cards: metricCards({
        platform: post.platform,
        latest,
        engagementD7: post.engagement_d7,
        daysSincePublished: post.published_at ? daysBetween(post.published_at, now) : 0,
      }),
      evolution: points,
      benchmark: benchmark({
        peers: (peerRows ?? [])
          .filter((p) => peerSnapshots.has(p.id))
          .map((p) => ({
            publishedAt: p.published_at as string,
            snapshots: peerSnapshots.get(p.id) as Snapshot[],
          })),
        metric,
        maxDay,
      }),
      audience: reachAudience(latest?.extra),
      bump,
      neighbors,
      comments: (commentRows ?? []).map((c) => ({
        id: c.id,
        authorUsername: c.author_username,
        text: c.text,
        commentedAt: c.commented_at,
        isOwn: c.is_own,
      })),
      metric,
    },
  };
}
