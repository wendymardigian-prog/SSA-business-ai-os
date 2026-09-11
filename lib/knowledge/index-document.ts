/**
 * El trabajo de indexar un documento (F16).
 *
 * Corre async, desde el runner de scheduled_jobs, porque convertir un PDF de
 * 25 MB y pedirle embeddings a Voyage no entra en el tiempo de una request.
 *
 * La regla que ordena todo el archivo: distinguir el fallo que se puede
 * reintentar del que no. Si falta la key de Voyage o el PDF esta danado,
 * reintentar tres veces no lo arregla — se deja el documento en 'error' con el
 * motivo a la vista y el job termina bien. Si Voyage devuelve 429 o se cae la
 * red, se lanza para que el runner reintente con backoff.
 *
 * Nunca se loguea el contenido del documento ni la API key.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { detectMimeType, extractMarkdown, type SupportedMime } from "./extract";
import { chunkMarkdown } from "./chunk";
import { generateEmbeddings } from "./embeddings";
import { toPgVector } from "./voyage";

/** Nombre del bucket privado (migracion 00050). */
export const KNOWLEDGE_BUCKET = "knowledge";

/** Tipo de job en scheduled_jobs. */
export const INDEX_DOCUMENT_JOB = "index_document";

export interface IndexDocumentPayload {
  documentId: string;
  workspaceId: string;
}

/**
 * Un fallo que reintentar no arregla.
 *
 * Se usa para separar las dos ramas sin depender de leer mensajes de error.
 */
class PermanentIndexError extends Error {}

export interface IndexOutcome {
  status: "ready" | "error";
  chunks: number;
  detail?: string;
}

type Db = SupabaseClient<Database>;

/**
 * Indexa un documento de punta a punta.
 *
 * Lanza solo cuando el fallo es transitorio, para que el runner reintente.
 * Cualquier otro final deja el documento marcado y devuelve el resultado.
 */
export async function indexDocument(
  supabase: Db,
  payload: IndexDocumentPayload,
): Promise<IndexOutcome> {
  const { documentId, workspaceId } = payload;

  try {
    const document = await loadDocument(supabase, documentId, workspaceId);

    // Borrado mientras estaba en cola: no hay nada que indexar y no es un error.
    if (!document) return { status: "ready", chunks: 0, detail: "documento inexistente" };

    const buffer = await downloadOriginal(supabase, document.source_file_path);
    const mime = resolveMime(buffer, document.source_filename, document.source_mime);
    const markdown = await toMarkdown(buffer, mime);
    const chunks = chunkMarkdown(markdown);

    if (chunks.length === 0) {
      throw new PermanentIndexError("El documento quedo vacio despues de procesarlo.");
    }

    // El markdown se guarda ANTES de pedir los embeddings, no despues.
    //
    // Si se guardara solo al final, un documento que se convirtio perfecto pero
    // no se pudo indexar (falta la key de Voyage, por ejemplo) quedaria sin
    // contenido a la vista, y no habria forma de distinguir "no pude leer el
    // archivo" de "lo lei bien pero no lo pude indexar". Con el texto guardado,
    // la pantalla de detalle lo muestra igual y se ve que la conversion anduvo.
    await supabase
      .from("knowledge_base")
      .update({ content_md: markdown })
      .eq("id", documentId);

    const embedded = await generateEmbeddings(
      workspaceId,
      chunks.map((c) => c.content),
      { inputType: "document", supabase },
    );

    if (!embedded.ok) {
      // Aca vive la distincion que ordena todo el archivo.
      if (embedded.retryable) throw new Error(embedded.message);
      throw new PermanentIndexError(embedded.message);
    }

    await writeChunks(supabase, {
      documentId,
      workspaceId,
      chunks,
      embeddings: embedded.embeddings,
    });

    await supabase
      .from("knowledge_base")
      .update({
        // content_md ya se guardo arriba: es el campo mas pesado de la fila y
        // no hace falta reescribirlo.
        status: "ready",
        chunk_count: chunks.length,
        embedding_model: embedded.model,
        indexed_at: new Date().toISOString(),
        error_detail: null,
      })
      .eq("id", documentId);

    return { status: "ready", chunks: chunks.length };
  } catch (err) {
    if (err instanceof PermanentIndexError) {
      await markFailed(supabase, documentId, err.message);
      return { status: "error", chunks: 0, detail: err.message };
    }

    // Transitorio: se deja el motivo visible pero el documento sigue en
    // 'processing', porque el runner lo va a volver a intentar.
    await supabase
      .from("knowledge_base")
      .update({ error_detail: err instanceof Error ? err.message : "error desconocido" })
      .eq("id", documentId);

    throw err;
  }
}

interface DocumentRow {
  source_file_path: string | null;
  source_filename: string | null;
  source_mime: string | null;
}

async function loadDocument(
  supabase: Db,
  documentId: string,
  workspaceId: string,
): Promise<DocumentRow | null> {
  const { data, error } = await supabase
    .from("knowledge_base")
    .select("source_file_path, source_filename, source_mime")
    .eq("id", documentId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    // Un fallo de lectura de la base es transitorio: que reintente.
    throw new Error(`No se pudo leer el documento: ${error.message}`);
  }

  return (data as DocumentRow | null) ?? null;
}

async function downloadOriginal(supabase: Db, path: string | null): Promise<Uint8Array> {
  if (!path) {
    throw new PermanentIndexError("El documento no tiene archivo asociado.");
  }

  const { data, error } = await supabase.storage.from(KNOWLEDGE_BUCKET).download(path);

  if (error || !data) {
    // Un 404 del bucket no se arregla reintentando; cualquier otra cosa, si.
    // El SDK no distingue de forma confiable, asi que se trata como transitorio
    // y son los 3 intentos del runner los que cierran el caso.
    throw new Error(`No se pudo bajar el archivo: ${error?.message ?? "sin datos"}`);
  }

  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Que es el archivo, ahora que lo tenemos entero.
 *
 * Se vuelve a detectar aunque la subida ya lo haya hecho: es barato y cierra la
 * puerta a que algo haya cambiado el archivo en el bucket entre la subida y el
 * procesamiento.
 */
function resolveMime(
  buffer: Uint8Array,
  filename: string | null,
  storedMime: string | null,
): SupportedMime {
  const detected = detectMimeType(buffer, filename ?? "");

  if (!detected.ok) {
    throw new PermanentIndexError(detected.error);
  }

  if (storedMime && storedMime !== detected.mime) {
    // No se corta: manda lo que dice el contenido. Pero queda el rastro.
    console.warn(
      `[kb] el tipo guardado (${storedMime}) no coincide con el detectado (${detected.mime})`,
    );
  }

  return detected.mime;
}

async function toMarkdown(buffer: Uint8Array, mime: SupportedMime): Promise<string> {
  const extracted = await extractMarkdown(buffer, mime);

  if (!extracted.ok) {
    // Un documento que no se puede convertir no se va a poder convertir nunca.
    throw new PermanentIndexError(extracted.error);
  }

  return extracted.markdown;
}

/**
 * Escribe los fragmentos, reemplazando los que hubiera.
 *
 * Borrar primero hace que reindexar sea idempotente: correr esto dos veces deja
 * la misma cantidad de fragmentos, no el doble.
 */
async function writeChunks(
  supabase: Db,
  args: {
    documentId: string;
    workspaceId: string;
    chunks: Array<{ index: number; content: string; tokenEstimate: number }>;
    embeddings: number[][];
  },
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("document_id", args.documentId);

  if (deleteError) {
    throw new Error(`No se pudieron limpiar los fragmentos anteriores: ${deleteError.message}`);
  }

  const rows = args.chunks.map((chunk, i) => ({
    workspace_id: args.workspaceId,
    document_id: args.documentId,
    chunk_index: chunk.index,
    content: chunk.content,
    token_estimate: chunk.tokenEstimate,
    embedding: toPgVector(args.embeddings[i]),
  }));

  // De a tandas: un documento grande son cientos de filas con un vector de 1024
  // numeros cada una, y un insert unico se pasa del tamano de request.
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from("knowledge_chunks").insert(rows.slice(i, i + BATCH));
    if (error) {
      throw new Error(`No se pudieron guardar los fragmentos: ${error.message}`);
    }
  }
}

async function markFailed(supabase: Db, documentId: string, detail: string): Promise<void> {
  const { error } = await supabase
    .from("knowledge_base")
    .update({ status: "error", error_detail: detail, chunk_count: 0 })
    .eq("id", documentId);

  if (error) {
    // Si ni siquiera se puede marcar el error, el documento queda en
    // 'processing' para siempre. Que quede en el log.
    console.error(`[kb] no pude marcar el documento ${documentId} como fallido:`, error.message);
  }
}
