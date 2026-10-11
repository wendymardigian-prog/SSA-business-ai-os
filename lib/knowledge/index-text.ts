/**
 * Indexar un TEXTO que ya tenemos (la transcripcion de una llamada) en la base
 * de conocimiento (F31). Es el hermano de `indexDocument`, que parte de un
 * archivo subido: aca no hay archivo que bajar ni convertir, solo pedazos que ya
 * vienen cortados.
 *
 * Reusa lo mismo que un documento subido: los embeddings de Voyage
 * (`generateEmbeddings`), la escritura de fragmentos (`writeChunks`, que borra los
 * anteriores y por eso reindexar es idempotente) y el run `kb_indexing` con su
 * costo. Y se comporta igual cuando algo falla: sin Voyage conectado el
 * documento queda `error` con el motivo a la vista.
 *
 * Los documentos que crea este modulo son SIEMPRE internos
 * (`internal_only = true`) si asi se pide: lo que sale de una llamada nunca llega
 * al agente que habla con leads.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { openAiRun } from "@/lib/ai/run";
import { estimateTokens } from "./voyage";
import { generateEmbeddings } from "./embeddings";
import { writeChunks } from "./index-document";

type Db = SupabaseClient<Database>;

export interface IndexTextInput {
  workspaceId: string;
  title: string;
  tags: string[];
  /** Un documento interno nunca llega al prompt del agente de leads. */
  internalOnly: boolean;
  sourceFilename: string;
  sourceMime: string;
  /** El texto completo, que se guarda para verlo en la pantalla del documento. */
  contentMd: string;
  /** Los pedazos ya cortados. */
  chunks: string[];
  /** Si ya hay un documento de esta fuente, se reemplaza en vez de crear otro. */
  replaceDocumentId?: string | null;
  createdBy?: string | null;
  /** Para atar el run al documento. */
  now?: Date;
}

export interface IndexTextOutcome {
  documentId: string | null;
  status: "ready" | "error";
  chunks: number;
  detail?: string;
  /** El fallo es transitorio (Voyage 429, red): conviene reintentar mas tarde. */
  retryable?: boolean;
}

export async function indexText(db: Db, input: IndexTextInput): Promise<IndexTextOutcome> {
  const now = input.now ?? new Date();
  const base = {
    title: input.title,
    tags: input.tags,
    internal_only: input.internalOnly,
    source_mime: input.sourceMime,
    source_filename: input.sourceFilename,
    source_file_path: null,
    source_size_bytes: new TextEncoder().encode(input.contentMd).length,
    content_md: input.contentMd,
    status: "processing" as const,
    error_detail: null,
    chunk_count: 0,
  };

  // Reemplazar: se reusa la fila (mismo id, mismo lugar en la lista) y se reindexa.
  let documentId: string | null = null;
  if (input.replaceDocumentId) {
    const { data: updated } = await db
      .from("knowledge_base")
      .update(base)
      .eq("id", input.replaceDocumentId)
      .eq("workspace_id", input.workspaceId)
      .is("deleted_at", null)
      .select("id");
    documentId = updated?.[0]?.id ?? null;
  }
  if (!documentId) {
    const { data, error } = await db
      .from("knowledge_base")
      .insert({ ...base, workspace_id: input.workspaceId, created_by: input.createdBy ?? null, created_at: now.toISOString() })
      .select("id")
      .single();
    if (error || !data) {
      console.error("[kb] no pude crear el documento de texto:", error?.message);
      return { documentId: null, status: "error", chunks: 0, detail: "No pude crear el documento.", retryable: true };
    }
    documentId = data.id;
  }

  const fail = async (detail: string, retryable: boolean): Promise<IndexTextOutcome> => {
    await db.from("knowledge_base").update({ status: "error", error_detail: detail, chunk_count: 0 }).eq("id", documentId!);
    return { documentId, status: "error", chunks: 0, detail, retryable };
  };

  if (input.chunks.length === 0) return fail("El texto quedó vacío después de procesarlo.", false);

  const run = await openAiRun(db, { workspaceId: input.workspaceId, source: "kb_indexing", trigger: "job", threadId: documentId });
  const startedAt = Date.now();
  const embedded = await generateEmbeddings(input.workspaceId, input.chunks, { inputType: "document", supabase: db });
  await run.step({
    kind: "model_call",
    name: embedded.ok ? `voyage/${embedded.model}` : "voyage",
    output: embedded.ok ? { chunks: input.chunks.length } : null,
    durationMs: Date.now() - startedAt,
    error: embedded.ok ? null : embedded.problem,
  });

  if (!embedded.ok) {
    await run.close({ status: "error", statusDetail: embedded.retryable ? "transient_retry" : "permanent", error: embedded.message });
    return fail(embedded.message, embedded.retryable);
  }

  run.setModel("voyage", embedded.model);
  run.addEmbeddingUsage({ provider: "voyage", model: embedded.model, tokens: embedded.totalTokens });

  await writeChunks(db, {
    documentId,
    workspaceId: input.workspaceId,
    chunks: input.chunks.map((content, index) => ({ index, content, tokenEstimate: estimateTokens(content) })),
    embeddings: embedded.embeddings,
  });
  await db
    .from("knowledge_base")
    .update({ status: "ready", chunk_count: input.chunks.length, embedding_model: embedded.model, indexed_at: now.toISOString(), error_detail: null })
    .eq("id", documentId);
  await run.close({ status: "completed" });
  return { documentId, status: "ready", chunks: input.chunks.length };
}
