/**
 * Borra la media de las piezas ya publicadas, pasado el plazo (F23).
 *
 * Diario. Recorre los workspaces con su propia retencion: 30 dias por defecto,
 * 0 = no borrar nunca.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { planCleanup, type PostToClean } from "@/lib/content/cleanup";
import type { MediaEntry } from "@/lib/content/media";

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();
  const now = new Date();

  const { data: workspaces, error } = await supabase
    .from("workspaces")
    .select("id, content_media_retention_days");

  if (error) {
    console.error("[content-media-cleanup] no pude leer los workspaces:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let cleanedPosts = 0;
  let deletedFiles = 0;

  for (const workspace of workspaces ?? []) {
    const retentionDays = workspace.content_media_retention_days ?? 30;
    if (retentionDays <= 0) continue;

    // Solo piezas publicadas y con media: el resto no tiene nada que limpiar.
    const { data: posts } = await supabase
      .from("content_posts")
      .select("id, media")
      .eq("workspace_id", workspace.id)
      .in("status", ["published", "partially_published"])
      .limit(200);

    if (!posts || posts.length === 0) continue;

    // Las fechas de publicacion, en una consulta aparte. La que cuenta es la
    // de la ULTIMA red que salio: si una se redistribuyo la semana pasada, el
    // archivo todavia hace falta.
    const { data: publications } = await supabase
      .from("social_posts")
      .select("content_post_id, published_at")
      .in("content_post_id", posts.map((p) => p.id))
      .not("published_at", "is", null);

    const lastPublished = new Map<string, string>();
    for (const row of publications ?? []) {
      if (!row.content_post_id || !row.published_at) continue;
      const current = lastPublished.get(row.content_post_id);
      if (!current || row.published_at > current) {
        lastPublished.set(row.content_post_id, row.published_at);
      }
    }

    const candidates: PostToClean[] = posts.map((post) => ({
      id: post.id,
      publishedAt: lastPublished.get(post.id) ?? null,
      media: (Array.isArray(post.media) ? post.media : []) as unknown as MediaEntry[],
    }));

    const plans = planCleanup({ posts: candidates, retentionDays, now });

    for (const plan of plans) {
      const { error: storageError } = await supabase.storage
        .from("content-media")
        .remove(plan.paths);

      if (storageError) {
        console.error(`[content-media-cleanup] ${plan.postId}:`, storageError.message);
        // Si no se pudo borrar, no se marca: al proximo dia se vuelve a
        // intentar. Marcar sin borrar dejaria el archivo ahi para siempre y
        // sin nadie que lo busque.
        continue;
      }

      const { error: updateError } = await supabase
        .from("content_posts")
        .update({ media: plan.media as never })
        .eq("id", plan.postId);

      if (updateError) {
        console.error(`[content-media-cleanup] ${plan.postId}:`, updateError.message);
        continue;
      }

      cleanedPosts++;
      deletedFiles += plan.paths.length;
    }
  }

  return NextResponse.json({ ok: true, cleanedPosts, deletedFiles });
}
