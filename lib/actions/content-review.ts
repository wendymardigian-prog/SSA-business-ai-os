"use server";

import { revalidatePath } from "next/cache";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { canApprove, canRequestReview, canReturn, statusAfterReview } from "@/lib/content/review";
import type { ContentPermissions } from "@/lib/content/status";
import { notifyReturnedToProduction, notifyReviewRequested } from "@/lib/notifications/content";
import { runPublication } from "@/lib/publishing/dispatcher";
import { publishDeps } from "@/lib/jobs/handlers/content-publish";
import { registerPublishing } from "@/lib/publishing/bootstrap";
import type { ContentPostStatus } from "@/lib/types/database";

/**
 * Mandar a revision, aprobar, devolver y reintentar (F37).
 *
 * El aviso es parte de la accion, no un extra: una pieza que espera revision
 * sin que nadie se entere se queda ahi. Pero un aviso que falla NO deshace la
 * decision, por eso va despues de escribir y no lanza.
 */

const CONTENT_PATH = "/dashboard/content";

export type ReviewActionResult =
  | { ok: true; status: ContentPostStatus }
  | { ok: false; error: string };

async function loadPost(postId: string) {
  // Por permiso y no por cargo (F78): un rol personalizado con `content.approve`
  // aprueba aunque sea Member, y un admin al que se lo sacaron, no.
  const { workspace, user, supabase, can } = await getPermissionContext();

  const { data: post } = await supabase
    .from("content_posts")
    .select("id, title, status, created_by")
    .eq("id", postId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!post) return null;

  const perms: ContentPermissions = {
    create: true,
    approve: can("content.approve"),
    publish: can("content.publish"),
    isAuthor: post.created_by === user.id,
  };

  return { workspace, user, supabase, post, perms };
}

export async function requestReview(input: { postId: string }): Promise<ReviewActionResult> {
  const loaded = await loadPost(input.postId);
  if (!loaded) return { ok: false, error: "No encontre esa pieza" };

  const { workspace, user, supabase, post, perms } = loaded;
  const decision = canRequestReview(perms, post.status);
  if (!decision.ok) return { ok: false, error: decision.reason };

  const status = statusAfterReview("request");
  const { error } = await supabase
    .from("content_posts")
    .update({ status, review_note: null })
    .eq("id", post.id);

  if (error) return { ok: false, error: "No pude mandarla a revision" };

  // Con service role: la notificacion va a Owner/Admin, y notifications no
  // tiene policy de INSERT para usuarios a proposito.
  const service = await createServiceClient();
  await notifyReviewRequested(service, {
    workspaceId: workspace.id,
    contentPostId: post.id,
    title: post.title,
    requestedBy: user.id,
  });

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "update",
    metadata: { kind: "content_review_requested", post_id: post.id },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, status };
}

export async function approvePost(input: { postId: string }): Promise<ReviewActionResult> {
  const loaded = await loadPost(input.postId);
  if (!loaded) return { ok: false, error: "No encontre esa pieza" };

  const { workspace, user, supabase, post, perms } = loaded;
  const decision = canApprove(perms, post.status);
  if (!decision.ok) return { ok: false, error: decision.reason };

  const status = statusAfterReview("approve");
  const { error } = await supabase
    .from("content_posts")
    .update({
      status,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      review_note: null,
      // Aprobar es justamente la revision humana del texto generado.
      ai_unreviewed: false,
    })
    .eq("id", post.id);

  if (error) return { ok: false, error: "No pude aprobarla" };

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "update",
    metadata: { kind: "content_approved", post_id: post.id },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, status };
}

export async function returnPost(input: {
  postId: string;
  comment: string;
}): Promise<ReviewActionResult> {
  const loaded = await loadPost(input.postId);
  if (!loaded) return { ok: false, error: "No encontre esa pieza" };

  const { workspace, user, supabase, post, perms } = loaded;
  const decision = canReturn(perms, post.status, input.comment);
  if (!decision.ok) return { ok: false, error: decision.reason };

  const comment = input.comment.trim();
  const status = statusAfterReview("return");
  const { error } = await supabase
    .from("content_posts")
    .update({ status, review_note: comment, approved_by: null, approved_at: null })
    .eq("id", post.id);

  if (error) return { ok: false, error: "No pude devolverla" };

  const service = await createServiceClient();
  await notifyReturnedToProduction(service, {
    workspaceId: workspace.id,
    contentPostId: post.id,
    title: post.title,
    recipientId: post.created_by,
    comment,
  });

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "update",
    // El comentario no va al audit: es texto libre de una persona sobre el
    // trabajo de otra, y el log lo lee cualquiera con acceso.
    metadata: { kind: "content_returned", post_id: post.id },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, status };
}

export type RetryResult =
  | { ok: true; retried: number }
  | { ok: false; error: string };

/**
 * Reintenta las redes que fallaron (F36).
 *
 * Vuelve a poner la fila en "programada" y publica en el momento, sin pasar
 * por la cola: quien aprieta el boton esta mirando la pantalla y espera ver
 * el resultado. Las que salieron no se tocan: reintentarlas seria
 * publicarlas dos veces.
 */
export async function retryFailedNetworks(input: { postId: string }): Promise<RetryResult> {
  const loaded = await loadPost(input.postId);
  if (!loaded) return { ok: false, error: "No encontre esa pieza" };

  const { workspace, user, supabase, post, perms } = loaded;
  if (!perms.publish) return { ok: false, error: "Reintentar es de quien puede publicar" };

  const service = await createServiceClient();
  const { data: failed } = await service
    .from("social_posts")
    .select("id")
    .eq("content_post_id", post.id)
    .eq("status", "failed")
    .is("deleted_at", null);

  if (!failed || failed.length === 0) {
    return { ok: false, error: "No hay ninguna red para reintentar" };
  }

  registerPublishing();
  const deps = publishDeps(service, workspace.id);
  let retried = 0;

  for (const row of failed) {
    // El contador vuelve a cero: es un reintento pedido a mano, no la
    // continuacion de los automaticos.
    await service
      .from("social_posts")
      .update({ status: "scheduled", attempts: 0, last_error: null, last_error_kind: null })
      .eq("id", row.id);

    const outcome = await runPublication(service, row.id, deps);
    if (outcome.kind === "published" || outcome.kind === "processing") retried++;
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "update",
    metadata: { kind: "content_retry", post_id: post.id, networks: failed.length },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, retried };
}

/**
 * Archiva una pieza (C5, C16).
 *
 * Faltaba. El detalle mandaba al editor y el editor contestaba "eso se hace
 * desde el detalle": un circulo del que no se salia, y por eso archivar era
 * imposible desde la pantalla.
 *
 * No borra nada: `archived_at` la saca del tablero y sigue en el historial.
 * Una pieza con publicaciones programadas no se archiva: quedaria fuera de la
 * vista y saliendo igual.
 */
export async function archivePost(input: { postId: string }): Promise<ReviewActionResult> {
  const loaded = await loadPost(input.postId);
  if (!loaded) return { ok: false, error: "No encontre esa pieza" };

  const { workspace, user, supabase, post, perms } = loaded;

  if (!perms.publish && !perms.approve) {
    return { ok: false, error: "Archivar es de quien aprueba o publica." };
  }

  const { data: vivas } = await supabase
    .from("social_posts")
    .select("platform")
    .eq("content_post_id", post.id)
    .in("status", ["uploading", "scheduled", "publishing"])
    .is("deleted_at", null);

  if ((vivas ?? []).length > 0) {
    return {
      ok: false,
      error: "Tiene publicaciones programadas. Desprogramalas antes de archivar.",
    };
  }

  const { error } = await supabase
    .from("content_posts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", post.id);

  if (error) {
    console.error("[content] no pude archivar:", error.message);
    return { ok: false, error: "No pude archivarla" };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "channel", entityId: workspace.id,
    action: "update",
    metadata: { kind: "content_archived", post_id: post.id },
    performedBy: user.id,
  });

  revalidatePath(CONTENT_PATH);
  return { ok: true, status: post.status };
}
