/**
 * Los documentos "pendientes de indexar" (F1).
 *
 * Un documento se puede subir sin que Voyage AI este conectado: queda en
 * `pending` con el archivo y su texto guardados. Cuando Voyage se conecta (o
 * alguien aprieta "Indexar pendientes"), esto los pone en cola.
 *
 * Reglas:
 *  - Sin duplicados: cada documento se RECLAMA con `UPDATE ... WHERE
 *    status = 'pending'` (devuelve la fila solo a quien lo gano) antes de
 *    encolar, y el job lleva una clave de dedupe por documento. Dos clics, o
 *    conectar Voyage mientras alguien aprieta el boton, no lo indexan dos veces.
 *  - Si no se pudo encolar, el documento VUELVE a `pending`: no se pierde ni
 *    queda en un "procesando" eterno.
 *  - Nunca lanza: conectar Voyage no puede fallar por esto, y un documento
 *    que falla no frena a los demas.
 *  - Nunca se loguea el contenido ni el titulo de un documento.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { scheduleJob } from "@/lib/scheduler";
import { INDEX_DOCUMENT_JOB } from "./index-document";

type Db = SupabaseClient<Database>;

/** Tope por tanda: un negocio con miles de documentos no encola todo de golpe. */
export const PENDING_BATCH_LIMIT = 200;

export const indexDedupeKey = (documentId: string) => `${INDEX_DOCUMENT_JOB}:${documentId}`;

export interface EnqueuePendingResult {
  /** Los que quedaron en cola ahora. */
  queued: number;
  /** Los que no se pudieron encolar (siguen pendientes). */
  failed: number;
  /** Cuantos pendientes quedan afuera de esta tanda por el tope. */
  remaining: number;
}

export async function enqueuePendingDocuments(service: Db, workspaceId: string): Promise<EnqueuePendingResult> {
  const result: EnqueuePendingResult = { queued: 0, failed: 0, remaining: 0 };
  try {
    const { data, error, count } = await service
      .from("knowledge_base")
      .select("id", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .is("deleted_at", null)
      .not("source_file_path", "is", null)
      .order("created_at", { ascending: true })
      .limit(PENDING_BATCH_LIMIT);
    if (error) {
      console.error("[kb] no pude leer los documentos pendientes:", error.message);
      return result;
    }
    const ids = (data ?? []).map((row) => row.id);
    result.remaining = Math.max(0, (count ?? ids.length) - ids.length);

    for (const id of ids) {
      // Reclamar: solo quien lo pasa de pending a processing lo encola.
      const { data: claimed, error: claimError } = await service
        .from("knowledge_base")
        .update({ status: "processing", error_detail: null })
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .eq("status", "pending")
        .select("id");
      if (claimError) {
        console.error("[kb] no pude reclamar un documento pendiente:", claimError.message);
        result.failed += 1;
        continue;
      }
      if (!claimed || claimed.length === 0) continue; // otro lo reclamo

      try {
        await scheduleJob(service, INDEX_DOCUMENT_JOB, { documentId: id, workspaceId }, new Date(), indexDedupeKey(id));
        result.queued += 1;
      } catch (err) {
        // 23505 = ya hay un job de este documento en cola: no es un fallo.
        if ((err as { code?: string } | null)?.code === "23505") {
          result.queued += 1;
          continue;
        }
        console.error("[kb] no pude encolar un documento pendiente:", err instanceof Error ? err.message : "error");
        await service.from("knowledge_base").update({ status: "pending" }).eq("id", id).eq("status", "processing");
        result.failed += 1;
      }
    }
  } catch (err) {
    console.error("[kb] error retomando los documentos pendientes:", err instanceof Error ? err.message : "error");
  }
  return result;
}

export { countPending } from "./pending-count";
