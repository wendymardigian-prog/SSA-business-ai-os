"use server";

import { revalidatePath } from "next/cache";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { moveToDay } from "@/lib/content/move-day";
import { plannedDateChanges } from "@/lib/content/reschedule";
import { reschedulePublication } from "@/lib/publishing/reschedule";

/**
 * Arrastrar una pieza a otro día en el calendario (C14).
 *
 * Lo que decide está en `lib/content/move-day.ts`. Acá se lee, se aplica y
 * —si alguna de esas redes YA estaba programada— se mueve también la
 * publicación: si no, el calendario mostraría el jueves y saldría el martes.
 */
export async function movePieceToDay(input: {
  postId: string;
  fromDay: string;
  toDay: string;
}): Promise<{ ok: true; moved: string[] } | { ok: false; error: string }> {
  const { workspace, user, supabase, can } = await getPermissionContext();
  if (!can("content.publish")) {
    return { ok: false, error: "Mover una fecha es de quien puede publicar." };
  }

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, networks")
    .eq("id", input.postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const { data: ws } = await supabase
    .from("workspaces")
    .select("timezone")
    .eq("id", workspace.id)
    .maybeSingle();

  const networks = (Array.isArray(post.networks) ? post.networks : []) as Array<{
    platform: string;
    planned_at?: string | null;
  }>;

  const decision = moveToDay({
    networks,
    fromDay: input.fromDay,
    toDay: input.toDay,
    timeZone: ws?.timezone || "America/Argentina/Buenos_Aires",
  });

  if (!decision.ok) return decision;

  const { error } = await supabase
    .from("content_posts")
    .update({ networks: decision.networks as never })
    .eq("id", post.id);

  if (error) return { ok: false, error: "No pude mover la fecha" };

  // Las redes que ya estaban programadas se mueven de verdad: si no, el
  // calendario diría el jueves y la publicación saldría el martes.
  const service = await createServiceClient();
  const { data: publications } = await service
    .from("social_posts")
    .select("id, platform, status, scheduled_at")
    .eq("content_post_id", post.id)
    .is("deleted_at", null);

  const cambios = plannedDateChanges(
    decision.networks.map((n) => ({ platform: n.platform, plannedAt: n.planned_at ?? null })),
    (publications ?? []).map((p) => ({
      platform: p.platform,
      status: p.status,
      scheduledAt: p.scheduled_at,
    })),
  );

  for (const cambio of cambios) {
    if (cambio.kind !== "reschedule") continue;
    const row = (publications ?? []).find((p) => p.platform === cambio.platform);
    if (row) {
      await reschedulePublication(service, {
        socialPostId: row.id,
        workspaceId: workspace.id,
        at: cambio.at,
      });
    }
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "channel",
    entityId: workspace.id,
    action: "update",
    metadata: {
      kind: "content_moved_day",
      post_id: post.id,
      from: input.fromDay,
      to: input.toDay,
      platforms: decision.moved,
    },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/content");
  return { ok: true, moved: decision.moved };
}
