"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { scheduleJob } from "@/lib/scheduler";
import { detectMimeType } from "@/lib/knowledge/extract";
import {
  validateFileSize,
  validateTitle,
  normalizeTags,
  titleFromFilename,
  storagePathFor,
  MAX_FILE_BYTES,
} from "@/lib/knowledge/validate";
import { INDEX_DOCUMENT_JOB, KNOWLEDGE_BUCKET } from "@/lib/knowledge/index-document";
import { isEmbeddingProviderConnected } from "@/lib/knowledge/embeddings";

/**
 * Server Actions de la base de conocimiento (F16, F17).
 *
 * Reglas que valen para todas:
 *
 * 1. El rol se revalida ACA. El guard de la pagina y el menu son comodidad; la
 *    barrera real es esta comprobacion mas la RLS de knowledge_base (00049).
 * 2. El tipo del archivo se decide por su CONTENIDO, no por la extension ni por
 *    el Content-Type: los dos los elige quien sube.
 * 3. El bucket es privado y no tiene policies: se entra con el service client,
 *    despues de haber verificado el rol aca arriba. El original solo sale por
 *    signed URL de vida corta.
 * 4. Ningun log lleva el contenido del documento.
 */

const KNOWLEDGE_PATH = "/dashboard/knowledge";

/** Cuanto vive el link de descarga del original. */
const SIGNED_URL_SECONDS = 60;

export type KnowledgeResult = { ok: true; documentId?: string } | { ok: false; error: string };

/**
 * Sube un documento y lo encola para indexar.
 *
 * El orden importa: primero la fila (para tener un id), despues el archivo
 * (cuya ruta usa ese id), despues el job. Si el archivo falla, la fila se borra
 * en vez de quedar como un documento fantasma que no se puede procesar.
 */
export async function uploadDocument(formData: FormData): Promise<KnowledgeResult> {
  const ctx = await getAdminContext();
  if (!ctx) {
    return { ok: false, error: "Solo Owner y Admin pueden gestionar la base de conocimiento" };
  }

  const { workspace, supabase, user } = ctx;

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Falta el archivo" };
  }

  const size = validateFileSize(file.size);
  if (!size.ok) return size;

  // Se lee entero porque hay que mirarle los bytes igual para saber que es.
  // El limite de tamano ya paso, asi que no puede ser desmedido.
  const buffer = new Uint8Array(await file.arrayBuffer());

  // Segunda medicion, ahora sobre los bytes que llegaron de verdad: file.size
  // es lo que declara el cliente.
  const realSize = validateFileSize(buffer.byteLength);
  if (!realSize.ok) return realSize;

  const detected = detectMimeType(buffer, file.name);
  if (!detected.ok) return { ok: false, error: detected.error };

  const rawTitle = String(formData.get("title") ?? "").trim() || titleFromFilename(file.name);
  const title = validateTitle(rawTitle);
  if (!title.ok) return title;

  const tags = normalizeTags(String(formData.get("tags") ?? ""));

  const { data: created, error: insertError } = await supabase
    .from("knowledge_base")
    .insert({
      workspace_id: workspace.id,
      title: rawTitle,
      tags,
      source_mime: detected.mime,
      source_size_bytes: buffer.byteLength,
      source_filename: file.name,
      status: "processing",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.error("[kb] no pude crear el documento:", insertError?.message);
    return { ok: false, error: "No se pudo guardar el documento. Proba de nuevo." };
  }

  const path = storagePathFor(workspace.id, created.id, detected.mime);

  // El bucket no tiene policies: entra el service client, ya con el rol
  // verificado arriba.
  const service = await createServiceClient();

  const { error: uploadError } = await service.storage
    .from(KNOWLEDGE_BUCKET)
    .upload(path, buffer, {
      contentType: detected.mime,
      upsert: true,
    });

  if (uploadError) {
    console.error("[kb] fallo la subida al bucket:", uploadError.message);
    // Sin archivo no hay nada que indexar: la fila no tiene por que quedar.
    await supabase.from("knowledge_base").delete().eq("id", created.id);
    return { ok: false, error: "No se pudo guardar el archivo. Proba de nuevo." };
  }

  const { error: pathError } = await supabase
    .from("knowledge_base")
    .update({ source_file_path: path })
    .eq("id", created.id);

  if (pathError) {
    console.error("[kb] no pude guardar la ruta del archivo:", pathError.message);
    return { ok: false, error: "No se pudo guardar el archivo. Proba de nuevo." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "create",
    metadata: {
      section: "knowledge_base",
      document_id: created.id,
      title: rawTitle,
      mime: detected.mime,
      size_bytes: buffer.byteLength,
    },
    performedBy: user.id,
  });

  const queued = await enqueueIndexing(service, created.id, workspace.id);
  if (!queued) {
    await supabase
      .from("knowledge_base")
      .update({
        status: "error",
        error_detail: "No se pudo encolar el procesamiento. Proba reprocesarlo.",
      })
      .eq("id", created.id);
  }

  revalidatePath(KNOWLEDGE_PATH);
  return { ok: true, documentId: created.id };
}

/** Encola el indexado. Devuelve si se pudo. */
async function enqueueIndexing(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  documentId: string,
  workspaceId: string,
): Promise<boolean> {
  try {
    await scheduleJob(service, INDEX_DOCUMENT_JOB, { documentId, workspaceId }, new Date());
    return true;
  } catch (err) {
    console.error(
      "[kb] no pude encolar el indexado:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/** Cambia titulo y etiquetas. No toca el archivo ni reindexado. */
export async function updateDocumentMetadata(
  documentId: string,
  rawTitle: string,
  rawTags: string,
): Promise<KnowledgeResult> {
  const ctx = await getAdminContext();
  if (!ctx) {
    return { ok: false, error: "Solo Owner y Admin pueden gestionar la base de conocimiento" };
  }

  const { workspace, supabase, user } = ctx;

  const title = validateTitle(rawTitle);
  if (!title.ok) return title;

  const tags = normalizeTags(rawTags);

  const { data: before } = await supabase
    .from("knowledge_base")
    .select("title, tags")
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!before) return { ok: false, error: "El documento no existe" };

  const { error } = await supabase
    .from("knowledge_base")
    .update({ title: rawTitle.trim(), tags })
    .eq("id", documentId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[kb] no pude actualizar el documento:", error.message);
    return { ok: false, error: "No se pudieron guardar los cambios." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "update",
    changes: diffFields(
      { title: before.title, tags: (before.tags ?? []).join(", ") },
      { title: rawTitle.trim(), tags: tags.join(", ") },
    ),
    metadata: { section: "knowledge_base", document_id: documentId },
    performedBy: user.id,
  });

  revalidatePath(KNOWLEDGE_PATH);
  revalidatePath(`${KNOWLEDGE_PATH}/${documentId}`);
  return { ok: true };
}

/**
 * Borrado blando: se marca, no se borra.
 *
 * El archivo del bucket y los fragmentos siguen ahi hasta que pase la ventana
 * de retencion, para que un borrado por error se pueda deshacer.
 */
export async function deleteDocument(documentId: string): Promise<KnowledgeResult> {
  const ctx = await getAdminContext();
  if (!ctx) {
    return { ok: false, error: "Solo Owner y Admin pueden gestionar la base de conocimiento" };
  }

  const { workspace, supabase, user } = ctx;

  const { data: document } = await supabase
    .from("knowledge_base")
    .select("title")
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!document) return { ok: false, error: "El documento no existe" };

  const { error } = await supabase
    .from("knowledge_base")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[kb] no pude eliminar el documento:", error.message);
    return { ok: false, error: "No se pudo eliminar el documento." };
  }

  await logAudit({
    supabase,
    workspaceId: workspace.id,
    entityType: "workspace",
    entityId: workspace.id,
    action: "delete",
    metadata: { section: "knowledge_base", document_id: documentId, title: document.title },
    performedBy: user.id,
  });

  revalidatePath(KNOWLEDGE_PATH);
  return { ok: true };
}

/** Vuelve a encolar el indexado de un documento que quedo en error. */
export async function reprocessDocument(documentId: string): Promise<KnowledgeResult> {
  const ctx = await getAdminContext();
  if (!ctx) {
    return { ok: false, error: "Solo Owner y Admin pueden gestionar la base de conocimiento" };
  }

  const { workspace, supabase } = ctx;

  const { data: document } = await supabase
    .from("knowledge_base")
    .select("source_file_path")
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!document) return { ok: false, error: "El documento no existe" };

  if (!document.source_file_path) {
    return {
      ok: false,
      error: "El documento no tiene archivo asociado. Volve a subirlo.",
    };
  }

  // Se avisa antes de encolar: si falta Voyage, el reintento terminaria en el
  // mismo error y no tiene sentido hacerla esperar para eso.
  if (!(await isEmbeddingProviderConnected(workspace.id, supabase))) {
    return {
      ok: false,
      error:
        "Falta conectar Voyage AI en Ajustes > Integraciones: es lo que indexa la base de conocimiento.",
    };
  }

  const { error } = await supabase
    .from("knowledge_base")
    .update({ status: "processing", error_detail: null })
    .eq("id", documentId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[kb] no pude marcar el documento para reprocesar:", error.message);
    return { ok: false, error: "No se pudo reprocesar el documento." };
  }

  const service = await createServiceClient();
  const queued = await enqueueIndexing(service, documentId, workspace.id);

  if (!queued) {
    await supabase
      .from("knowledge_base")
      .update({ status: "error", error_detail: "No se pudo encolar el procesamiento." })
      .eq("id", documentId);
    return { ok: false, error: "No se pudo encolar el procesamiento. Proba de nuevo." };
  }

  revalidatePath(KNOWLEDGE_PATH);
  revalidatePath(`${KNOWLEDGE_PATH}/${documentId}`);
  return { ok: true };
}

export type SignedUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Un link temporal para bajar el original.
 *
 * El bucket es privado: esta es la unica forma de llegar al archivo, y el link
 * dura un minuto. Se verifica el rol y que el documento sea de este workspace
 * antes de firmar nada.
 */
export async function getDocumentSignedUrl(documentId: string): Promise<SignedUrlResult> {
  const ctx = await getAdminContext();
  if (!ctx) {
    return { ok: false, error: "Solo Owner y Admin pueden descargar documentos" };
  }

  const { workspace, supabase } = ctx;

  const { data: document } = await supabase
    .from("knowledge_base")
    .select("source_file_path")
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!document?.source_file_path) {
    return { ok: false, error: "El documento no tiene archivo asociado." };
  }

  const service = await createServiceClient();
  const { data, error } = await service.storage
    .from(KNOWLEDGE_BUCKET)
    .createSignedUrl(document.source_file_path, SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error("[kb] no pude firmar la descarga:", error?.message);
    return { ok: false, error: "No se pudo generar el link de descarga." };
  }

  return { ok: true, url: data.signedUrl };
}

/** El limite de tamano, para que el cliente lo muestre sin duplicar la constante. */
export async function getMaxUploadBytes(): Promise<number> {
  return MAX_FILE_BYTES;
}
