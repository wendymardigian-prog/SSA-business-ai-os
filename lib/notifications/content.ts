/**
 * Avisos del pipeline de contenido (F35, F37).
 *
 * Tres momentos, tres destinatarios distintos:
 * - **Pedir revision**: a quien puede aprobar (Owner/Admin), sin destinatario
 *   fijo, porque lo resuelve la RLS por rol.
 * - **Devolver a produccion**: a quien escribio la pieza, con el comentario.
 *   Es el unico de los tres dirigido a una persona concreta.
 * - **No salio**: a Owner/Admin, porque hay que arreglar la conexion o
 *   reprogramar, y eso no lo puede hacer un Member.
 *
 * Como todo aviso, ninguno lanza: que falle el aviso no puede cambiar el
 * resultado de la publicacion.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createNotification, createNotificationOnce } from "./create";

type Db = SupabaseClient<Database>;

export async function notifyReviewRequested(
  supabase: Db,
  params: { workspaceId: string; contentPostId: string; title: string; requestedBy: string | null },
): Promise<boolean> {
  return createNotification({
    supabase,
    workspaceId: params.workspaceId,
    type: "content_review_requested",
    title: "Una pieza espera revision",
    body: `"${params.title}" paso a revision.`,
    entityType: "content_post",
    entityId: params.contentPostId,
    metadata: { requested_by: params.requestedBy },
  });
}

export async function notifyReturnedToProduction(
  supabase: Db,
  params: {
    workspaceId: string;
    contentPostId: string;
    title: string;
    recipientId: string | null;
    comment: string;
  },
): Promise<boolean> {
  return createNotification({
    supabase,
    workspaceId: params.workspaceId,
    type: "content_returned",
    title: "Te devolvieron una pieza",
    // El comentario va en el cuerpo: sin el, el aviso obliga a entrar para
    // enterarse de que hay que cambiar.
    body: `"${params.title}": ${params.comment}`,
    entityType: "content_post",
    entityId: params.contentPostId,
    recipientId: params.recipientId,
  });
}

export async function notifyPublishFailure(
  supabase: Db,
  params: {
    workspaceId: string;
    contentPostId: string | null;
    platform: string;
    reason: string;
  },
): Promise<boolean> {
  // Una vez por pieza y hora: tres redes que fallan por el mismo token
  // vencido son un problema, no tres.
  return createNotificationOnce({
    supabase,
    workspaceId: params.workspaceId,
    type: "content_publish_failed",
    title: "Una publicacion no salio",
    body: params.reason,
    entityType: "content_post",
    entityId: params.contentPostId,
    metadata: { platform: params.platform },
    withinMinutes: 60,
  });
}

// ── El copywriter (E6) ────────────────────────────────────────────────────

export async function notifyCopyReady(
  supabase: Db,
  params: { workspaceId: string; contentPostId: string; warnings: string[] },
): Promise<boolean> {
  return createNotification({
    supabase,
    workspaceId: params.workspaceId,
    type: "content_copy_ready",
    title: "El copywriter termino",
    body:
      params.warnings.length > 0
        ? `Escribio el guion y los captions, con ${params.warnings.length} aviso(s) para revisar.`
        : "Escribio el guion y los captions. Revisalos antes de aprobar.",
    entityType: "content_post",
    entityId: params.contentPostId,
    metadata: { warnings: params.warnings },
  });
}

export async function notifyCopyFailed(
  supabase: Db,
  params: { workspaceId: string; contentPostId: string; reason: string },
): Promise<boolean> {
  return createNotification({
    supabase,
    workspaceId: params.workspaceId,
    type: "content_copy_failed",
    title: "El copywriter no pudo escribir",
    body: params.reason,
    entityType: "content_post",
    entityId: params.contentPostId,
  });
}
