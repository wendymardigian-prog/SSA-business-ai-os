"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/workspace-members";

/**
 * El responsable de una publicacion SIN pieza (Extra I, F43).
 *
 * Una publicacion de una pieza usa el responsable de la pieza (`content_posts.assigned_to`); una externa o marcada a
 * mano no tiene pieza, y su responsable se guarda en `social_posts.assigned_to` (00230).
 *
 * Permiso: `content.publish`, el mismo que hoy gobierna marcar y desmarcar una publicacion a mano
 * (`lib/actions/content-schedule.ts`). El workspace sale SIEMPRE de la sesion. La base ademas exige que la persona
 * sea miembro del workspace (trigger de la 00230): aca se chequea antes para dar un mensaje claro.
 *
 * Los tipos del resultado viven aca mismo como interfaces no exportadas: en un archivo "use server" solo se exportan
 * funciones asincronicas.
 */

type Result = { ok: true; assignedTo: string | null } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (error: string): Result => ({ ok: false, error });

export async function setSocialPostAssignee(socialPostId: string, userId: string | null): Promise<Result> {
  const ctx = await getPermissionAction("content.publish");
  if (!ctx) return fail("No tenés permiso para cambiar el responsable de una publicación");

  if (typeof socialPostId !== "string" || !UUID.test(socialPostId)) return fail("No encontré esa publicación");
  const target = userId === null || userId === "" ? null : userId;
  if (target !== null && (typeof target !== "string" || !UUID.test(target))) return fail("Elegí una persona del equipo");

  const service = await createServiceClient();
  const { data: post, error: readError } = await service
    .from("social_posts")
    .select("id, content_post_id, assigned_to")
    .eq("id", socialPostId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[social] no pude leer la publicación:", readError.message);
    return fail("No pude guardar el responsable. Probá de nuevo.");
  }
  if (!post) return fail("No encontré esa publicación");
  if (post.content_post_id) {
    return fail("Esta publicación es de una pieza: el responsable es el de la pieza. Cambialo desde la pieza.");
  }

  if (target !== null) {
    const members = await getWorkspaceMembers(ctx.workspace.id);
    if (!members.some((m) => m.userId === target)) return fail("Esa persona no es del equipo");
  }

  const before = (post.assigned_to as string | null) ?? null;
  if (before === target) return { ok: true, assignedTo: target };

  const { data: updated, error } = await service
    .from("social_posts")
    .update({ assigned_to: target } as never)
    .eq("id", socialPostId)
    .eq("workspace_id", ctx.workspace.id)
    .is("content_post_id", null)
    .select("id");
  if (error) {
    console.error("[social] no pude cambiar el responsable:", error.message);
    return fail("No pude guardar el responsable. Probá de nuevo.");
  }
  if (!updated || updated.length === 0) return fail("No encontré esa publicación");

  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "social_post",
    entityId: socialPostId,
    action: "social_post.assignee_changed",
    changes: { assigned_to: { old: before, new: target } },
    performedBy: ctx.user.id,
  });

  revalidatePath("/dashboard/social");
  return { ok: true, assignedTo: target };
}
