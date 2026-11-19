"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { scheduleJob } from "@/lib/scheduler";
import { detectMimeType } from "@/lib/knowledge/extract";
import { normalizeTags, storagePathFor, validateFileSize, validateTitle, type SupportedMime } from "@/lib/knowledge/validate";
import { INDEX_DOCUMENT_JOB, KNOWLEDGE_BUCKET, retireChunks } from "@/lib/knowledge/index-document";
import { isEmbeddingProviderConnected } from "@/lib/knowledge/embeddings";
import { resolveFolderId, validateFolderName } from "@/lib/knowledge/folders";
import { fetchLinkAsMarkdown } from "@/lib/knowledge/link";

/**
 * Carpetas, enlaces y reemplazo de documentos de la base.
 *
 * Igual que `lib/actions/knowledge.ts`: el permiso `knowledge.edit` se revalida
 * aquí; las carpetas las escribe solo el servidor (00412, sin políticas de
 * escritura); el bucket es privado y se entra con el cliente de servicio.
 *
 * Reemplazar (un archivo nuevo o volver a leer un enlace) retira los trozos
 * viejos ANTES de encolar el indexado: mientras se reindexa, el agente no
 * encuentra nada de ese documento en vez de citar una versión que ya no existe.
 */

const KNOWLEDGE_PATH = "/dashboard/knowledge";
const NO_PERMISSION = "No tenés permiso para gestionar la base de conocimiento";

export type SourceResult = { ok: true; id?: string; pending?: boolean } | { ok: false; error: string };

type Service = Awaited<ReturnType<typeof createServiceClient>>;

// ─── Carpetas ───────────────────────────────────────────────────────────────

export async function createFolder(rawName: string): Promise<SourceResult> {
  const ctx = await getPermissionAction("knowledge.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const name = validateFolderName(rawName);
  if (!name.ok) return name;
  const service = await createServiceClient();
  const { data, error } = await service
    .from("knowledge_folders")
    .insert({ workspace_id: ctx.workspace.id, name: name.name, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return { ok: false, error: "Ya hay una carpeta con ese nombre." };
    console.error("[kb] no pude crear la carpeta:", error?.message);
    return { ok: false, error: "No se pudo crear la carpeta. Intentalo de nuevo." };
  }
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "create",
    metadata: { section: "knowledge_folders", folder_id: data.id, name: name.name },
    performedBy: ctx.user.id,
  });
  revalidatePath(KNOWLEDGE_PATH);
  return { ok: true, id: data.id };
}

export async function renameFolder(folderId: string, rawName: string): Promise<SourceResult> {
  const ctx = await getPermissionAction("knowledge.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const name = validateFolderName(rawName);
  if (!name.ok) return name;
  const service = await createServiceClient();
  const { data, error } = await service
    .from("knowledge_folders")
    .update({ name: name.name })
    .eq("id", folderId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya hay una carpeta con ese nombre." };
    console.error("[kb] no pude renombrar la carpeta:", error.message);
    return { ok: false, error: "No se pudo renombrar la carpeta." };
  }
  if (!data?.length) return { ok: false, error: "La carpeta no existe." };
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "update",
    metadata: { section: "knowledge_folders", folder_id: folderId, name: name.name },
    performedBy: ctx.user.id,
  });
  revalidatePath(KNOWLEDGE_PATH);
  return { ok: true, id: folderId };
}

/**
 * Borrado blando de la carpeta. Sus documentos NO se borran: quedan sin
 * carpeta. Un agente que tenía acceso por esa carpeta deja de llegar a ellos
 * (la búsqueda ignora carpetas borradas): se avisa en la pantalla antes.
 */
export async function deleteFolder(folderId: string): Promise<SourceResult> {
  const ctx = await getPermissionAction("knowledge.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const service = await createServiceClient();
  const { data, error } = await service
    .from("knowledge_folders")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", folderId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .select("id, name");
  if (error) {
    console.error("[kb] no pude borrar la carpeta:", error.message);
    return { ok: false, error: "No se pudo eliminar la carpeta." };
  }
  if (!data?.length) return { ok: false, error: "La carpeta no existe." };
  const { error: moveError } = await ctx.supabase
    .from("knowledge_base")
    .update({ folder_id: null })
    .eq("workspace_id", ctx.workspace.id)
    .eq("folder_id", folderId);
  if (moveError) console.error("[kb] no pude sacar los documentos de la carpeta:", moveError.message);
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "delete",
    metadata: { section: "knowledge_folders", folder_id: folderId, name: data[0].name },
    performedBy: ctx.user.id,
  });
  revalidatePath(KNOWLEDGE_PATH);
  return { ok: true };
}

export async function moveDocumentToFolder(documentId: string, rawFolderId: string | null): Promise<SourceResult> {
  const ctx = await getPermissionAction("knowledge.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const service = await createServiceClient();
  const folderId = await resolveFolderId(service, ctx.workspace.id, rawFolderId);
  if (folderId === undefined) return { ok: false, error: "La carpeta no existe." };
  const { data, error } = await ctx.supabase
    .from("knowledge_base")
    .update({ folder_id: folderId })
    .eq("id", documentId)
    .eq("workspace_id", ctx.workspace.id)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    console.error("[kb] no pude mover el documento:", error.message);
    return { ok: false, error: "No se pudo mover el documento." };
  }
  if (!data?.length) return { ok: false, error: "El documento no existe." };
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "update",
    metadata: { section: "knowledge_base", document_id: documentId, folder_id: folderId },
    performedBy: ctx.user.id,
  });
  revalidatePath(KNOWLEDGE_PATH);
  revalidatePath(`${KNOWLEDGE_PATH}/${documentId}`);
  return { ok: true };
}

// ─── Guardar la fuente y encolar ────────────────────────────────────────────

/**
 * Sube la fuente (archivo o foto del enlace), retira los trozos viejos y deja el
 * documento en cola. Común a crear un enlace, volver a leerlo y reemplazar un
 * archivo. Devuelve `pending` si falta Voyage (se retoma solo al conectarlo).
 */
async function storeSourceAndQueue(args: {
  service: Service;
  supabase: NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>["supabase"];
  workspaceId: string;
  documentId: string;
  bytes: Uint8Array;
  mime: SupportedMime;
  filename: string;
  sourceUrl: string | null;
}): Promise<SourceResult> {
  const path = storagePathFor(args.workspaceId, args.documentId, args.mime);
  const { error: uploadError } = await args.service.storage.from(KNOWLEDGE_BUCKET).upload(path, args.bytes, { contentType: args.mime, upsert: true });
  if (uploadError) {
    console.error("[kb] fallo la subida al bucket:", uploadError.message);
    return { ok: false, error: "No se pudo guardar el archivo. Intentalo de nuevo." };
  }

  // : la versión vieja deja de existir YA.
  const retired = await retireChunks(args.service, args.documentId);
  if (!retired) return { ok: false, error: "No se pudieron retirar los trozos de la versión anterior. Intentalo de nuevo." };

  const connected = await isEmbeddingProviderConnected(args.workspaceId, args.supabase);
  const { error: updateError } = await args.supabase
    .from("knowledge_base")
    .update({
      source_file_path: path,
      source_mime: args.mime,
      source_size_bytes: args.bytes.byteLength,
      source_filename: args.filename,
      source_url: args.sourceUrl,
      content_md: null,
      status: connected ? "processing" : "pending",
      error_detail: null,
      chunk_count: 0,
      indexed_at: null,
    })
    .eq("id", args.documentId)
    .eq("workspace_id", args.workspaceId);
  if (updateError) {
    console.error("[kb] no pude actualizar el documento:", updateError.message);
    return { ok: false, error: "No se pudo guardar el documento. Intentalo de nuevo." };
  }

  if (!connected) return { ok: true, id: args.documentId, pending: true };

  try {
    await scheduleJob(args.service, INDEX_DOCUMENT_JOB, { documentId: args.documentId, workspaceId: args.workspaceId }, new Date());
  } catch (err) {
    console.error("[kb] no pude encolar el indexado:", err instanceof Error ? err.message : String(err));
    await args.supabase
      .from("knowledge_base")
      .update({ status: "error", error_detail: "No se pudo encolar el procesamiento. Probá reprocesarlo." })
      .eq("id", args.documentId);
    return { ok: false, error: "No se pudo encolar el procesamiento. Probá reprocesarlo." };
  }
  return { ok: true, id: args.documentId };
}

function linkSnapshot(url: string, title: string | null, markdown: string): Uint8Array {
  const header = `# ${title ?? url}\n\nFuente: ${url}\n\n`;
  return new TextEncoder().encode(header + markdown);
}

// ─── Enlaces ────────────────────────────────────────────────────────────────

export async function addLinkDocument(input: { url: string; title?: string; tags?: string; folderId?: string | null }): Promise<SourceResult> {
  const ctx = await getPermissionAction("knowledge.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;
  const service = await createServiceClient();

  const folderId = await resolveFolderId(service, workspace.id, input.folderId ?? null);
  if (folderId === undefined) return { ok: false, error: "La carpeta no existe." };

  const page = await fetchLinkAsMarkdown(input.url);
  if (!page.ok) return page;

  const rawTitle = (input.title ?? "").trim() || page.title || new URL(page.url).hostname;
  const title = validateTitle(rawTitle);
  if (!title.ok) return title;
  const bytes = linkSnapshot(page.url, page.title, page.markdown);
  const size = validateFileSize(bytes.byteLength);
  if (!size.ok) return size;

  const { data: created, error } = await supabase
    .from("knowledge_base")
    .insert({
      workspace_id: workspace.id,
      title: rawTitle.slice(0, 200),
      tags: normalizeTags(input.tags ?? ""),
      folder_id: folderId,
      source_kind: "link",
      source_url: page.url,
      source_mime: "text/markdown",
      source_filename: "enlace.md",
      source_size_bytes: bytes.byteLength,
      status: "processing",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[kb] no pude crear el enlace:", error?.message);
    return { ok: false, error: "No se pudo guardar el enlace. Intentalo de nuevo." };
  }

  const stored = await storeSourceAndQueue({ service, supabase, workspaceId: workspace.id, documentId: created.id, bytes, mime: "text/markdown", filename: "enlace.md", sourceUrl: page.url });
  if (!stored.ok) {
    // Sin la foto guardada no hay nada que indexar: la fila no se queda.
    await supabase.from("knowledge_base").delete().eq("id", created.id);
    return stored;
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "create",
    metadata: { section: "knowledge_base", document_id: created.id, kind: "link", host: new URL(page.url).hostname, truncated: page.truncated },
    performedBy: user.id,
  });
  revalidatePath(KNOWLEDGE_PATH);
  return stored;
}

/** Vuelve a leer la página de un documento-enlace y lo reindexa sin trozos viejos. */
export async function refreshLinkDocument(documentId: string): Promise<SourceResult> {
  const ctx = await getPermissionAction("knowledge.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;
  const { data: doc } = await supabase
    .from("knowledge_base")
    .select("id, source_kind, source_url")
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc) return { ok: false, error: "El documento no existe." };
  if (doc.source_kind !== "link" || !doc.source_url) return { ok: false, error: "Este documento no es un enlace." };

  const page = await fetchLinkAsMarkdown(doc.source_url);
  if (!page.ok) return page;
  const bytes = linkSnapshot(page.url, page.title, page.markdown);
  const size = validateFileSize(bytes.byteLength);
  if (!size.ok) return size;

  const service = await createServiceClient();
  const stored = await storeSourceAndQueue({ service, supabase, workspaceId: workspace.id, documentId, bytes, mime: "text/markdown", filename: "enlace.md", sourceUrl: page.url });
  if (!stored.ok) return stored;
  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    metadata: { section: "knowledge_base", document_id: documentId, kind: "link", reindex: true },
    performedBy: user.id,
  });
  revalidatePath(KNOWLEDGE_PATH);
  revalidatePath(`${KNOWLEDGE_PATH}/${documentId}`);
  return stored;
}

// ─── Reemplazar un archivo ──────────────────────────────────────────────────

/** Sube una versión nueva de un documento-archivo: mismo documento, mismo lugar, trozos nuevos. */
export async function replaceDocumentFile(formData: FormData): Promise<SourceResult> {
  const ctx = await getPermissionAction("knowledge.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;
  const documentId = String(formData.get("documentId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Falta el archivo." };

  const { data: doc } = await supabase
    .from("knowledge_base")
    .select("id, source_kind")
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc) return { ok: false, error: "El documento no existe." };
  if (doc.source_kind !== "file") return { ok: false, error: "Solo se puede reemplazar el archivo de un documento subido." };

  const declared = validateFileSize(file.size);
  if (!declared.ok) return declared;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const real = validateFileSize(bytes.byteLength);
  if (!real.ok) return real;
  const detected = detectMimeType(bytes, file.name);
  if (!detected.ok) return { ok: false, error: detected.error };

  const service = await createServiceClient();
  const stored = await storeSourceAndQueue({ service, supabase, workspaceId: workspace.id, documentId, bytes, mime: detected.mime, filename: file.name, sourceUrl: null });
  if (!stored.ok) return stored;
  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    metadata: { section: "knowledge_base", document_id: documentId, replaced: true, mime: detected.mime, size_bytes: bytes.byteLength },
    performedBy: user.id,
  });
  revalidatePath(KNOWLEDGE_PATH);
  revalidatePath(`${KNOWLEDGE_PATH}/${documentId}`);
  return stored;
}
