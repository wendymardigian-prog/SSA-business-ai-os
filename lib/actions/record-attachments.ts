"use server";

/**
 * Archivos adjuntos de los comentarios de la ficha del cliente (00520) y de los comentarios de las tareas (00521).
 *
 * El cuadro manda UN archivo por vez (cada uno hasta 25 MB), después de guardar la nota o el comentario. Solo adjunta
 * quien lo escribió, con el mismo permiso con el que comenta, y viendo la nota o la tarea con su SESIÓN. El tipo se
 * decide por los BYTES; el archivo lo sube y lo registra el cliente de servicio (el bucket no tiene políticas). Los
 * logs no llevan nombres de archivo ni textos.
 */
import { randomUUID } from "node:crypto";
import { getMemberAction, getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import {
  RECORD_ATTACHMENTS_BUCKET,
  RECORD_ATTACHMENTS_MAX,
  RECORD_ATTACHMENT_SIGNED_SECONDS,
  classifyRecordFile,
  cleanRecordFileName,
  recordAttachmentPath,
} from "@/lib/attachments/record-files";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AttachResult = { ok: true } | { ok: false; error: string };
export type AttachmentUrlResult = { ok: true; url: string } | { ok: false; error: string };

type Target =
  | { table: "contact_note_attachments"; parentColumn: "note_id"; parentId: string; folder: string; extra: Record<string, unknown> }
  | { table: "comment_attachments"; parentColumn: "comment_id"; parentId: string; folder: string; extra: Record<string, unknown> };

async function store(ctx: NonNullable<Awaited<ReturnType<typeof getMemberAction>>>, target: Target, file: File): Promise<AttachResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = classifyRecordFile(bytes.slice(0, 64), file.type, file.name, file.size);
  if (!kind.ok) return { ok: false, error: kind.error };
  const service = await createServiceClient();
  const { count, error: countError } = await service
    .from(target.table as never)
    .select("id", { count: "exact", head: true })
    .eq(target.parentColumn, target.parentId);
  if (countError) {
    console.error("[adjuntos] no pude contar los adjuntos:", countError.code ?? "?");
    return { ok: false, error: "Todavía no se pueden adjuntar archivos. Probá más tarde." };
  }
  if ((count ?? 0) >= RECORD_ATTACHMENTS_MAX) return { ok: false, error: `Se pueden adjuntar como máximo ${RECORD_ATTACHMENTS_MAX} archivos.` };
  const name = cleanRecordFileName(file.name);
  const path = recordAttachmentPath(ctx.workspace.id, target.folder, randomUUID(), name);
  const { error: upError } = await service.storage.from(RECORD_ATTACHMENTS_BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
  if (upError) {
    console.error("[adjuntos] no pude subir el archivo:", upError.message);
    return { ok: false, error: "No pude subir el archivo. Probá de nuevo." };
  }
  const { error } = await service.from(target.table as never).insert({
    workspace_id: ctx.workspace.id,
    [target.parentColumn]: target.parentId,
    ...target.extra,
    storage_path: path,
    file_name: name,
    mime: kind.mime,
    size_bytes: file.size,
    created_by: ctx.user.id,
  } as never);
  if (error) {
    console.error("[adjuntos] no pude registrar el archivo:", error.code ?? "?");
    await service.storage.from(RECORD_ATTACHMENTS_BUCKET).remove([path]).catch(() => undefined);
    return { ok: false, error: error.message?.includes("como máximo") ? `Se pueden adjuntar como máximo ${RECORD_ATTACHMENTS_MAX} archivos.` : "No pude guardar el archivo. Probá de nuevo." };
  }
  return { ok: true };
}

/** Adjuntar UN archivo a un comentario de la ficha del cliente (`contact_notes`). Solo quien lo escribió. */
export async function attachNoteFile(form: FormData): Promise<AttachResult> {
  // El mismo permiso con el que se comenta en la ficha (`addClientComment`).
  const ctx = await getPermissionAction("services.view");
  if (!ctx) return { ok: false, error: "No tenés permiso para adjuntar archivos." };
  const noteId = form.get("noteId");
  const file = form.get("file");
  if (typeof noteId !== "string" || !UUID.test(noteId) || !(file instanceof File)) return { ok: false, error: "Los datos no son válidos." };
  // Con la sesión: la RLS de la nota (y la del contacto) decide si la ve.
  const { data: note } = await ctx.supabase
    .from("contact_notes")
    .select("id, created_by")
    .eq("id", noteId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!note) return { ok: false, error: "No encontramos ese comentario." };
  if ((note as { created_by: string | null }).created_by !== ctx.user.id) return { ok: false, error: "Solo podés adjuntar archivos a tus comentarios." };
  return store(ctx, { table: "contact_note_attachments", parentColumn: "note_id", parentId: noteId, folder: `notes/${noteId}`, extra: {} }, file);
}

/** Adjuntar UN archivo a un comentario de una tarea (`public.comments`). Solo quien lo escribió. */
export async function attachCommentFile(form: FormData): Promise<AttachResult> {
  // El mismo permiso con el que se comenta en una tarea (`postTeamComment`).
  const ctx = await getMemberAction();
  if (!ctx || !ctx.can("tasks.view")) return { ok: false, error: "No tenés permiso para adjuntar archivos." };
  const commentId = form.get("commentId");
  const file = form.get("file");
  if (typeof commentId !== "string" || !UUID.test(commentId) || !(file instanceof File)) return { ok: false, error: "Los datos no son válidos." };
  // Con la sesión: la RLS de `comments` deja ver solo los de una tarea que la persona ve.
  const { data: comment } = await ctx.supabase
    .from("comments")
    .select("id, author_id, entity_type, entity_id, kind")
    .eq("id", commentId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  const c = comment as { id: string; author_id: string | null; entity_type: string; entity_id: string; kind: string } | null;
  if (!c) return { ok: false, error: "No encontramos ese comentario." };
  // Por ahora, solo en los comentarios de las tareas.
  if (c.entity_type !== "task" || c.kind !== "comment") return { ok: false, error: "Acá todavía no se pueden adjuntar archivos." };
  if (c.author_id !== ctx.user.id) return { ok: false, error: "Solo podés adjuntar archivos a tus comentarios." };
  return store(ctx, { table: "comment_attachments", parentColumn: "comment_id", parentId: commentId, folder: `comments/${commentId}`, extra: { entity_type: c.entity_type, entity_id: c.entity_id } }, file);
}

/** Un enlace de descarga de 5 minutos para un adjunto que la persona ve (lo decide la RLS de la tabla). */
export async function recordAttachmentUrl(kind: "note" | "comment", id: string): Promise<AttachmentUrlResult> {
  const ctx = await getMemberAction();
  if (!ctx || !UUID.test(id)) return { ok: false, error: "Ese archivo ya no está." };
  const table = kind === "note" ? "contact_note_attachments" : "comment_attachments";
  const { data } = await ctx.supabase.from(table as never).select("storage_path, file_name").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle();
  const row = data as { storage_path: string; file_name: string } | null;
  if (!row) return { ok: false, error: "Ese archivo ya no está." };
  const service = await createServiceClient();
  const { data: signed, error } = await service.storage.from(RECORD_ATTACHMENTS_BUCKET).createSignedUrl(row.storage_path, RECORD_ATTACHMENT_SIGNED_SECONDS, { download: row.file_name });
  if (error || !signed?.signedUrl) return { ok: false, error: "No pude abrir el archivo. Probá de nuevo." };
  return { ok: true, url: signed.signedUrl };
}
