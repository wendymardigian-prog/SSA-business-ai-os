import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AiRunHandle } from "@/lib/ai/run";
import { embedQuery } from "@/lib/knowledge/embeddings";
import { toPgVector } from "@/lib/knowledge/voyage";

/**
 * Busqueda en la base de conocimiento para el agente (F27).
 *
 * El filtro de acceso (tags permitidos, documentos internal_only) va DENTRO de
 * la consulta SQL: match_knowledge_chunks_filtered (00062). Un documento
 * excluido nunca sale de la base, asi que no puede terminar en el prompt por
 * un bug de este lado. Aca no se filtra nada despues: si hiciera falta,
 * significaria que el filtro de la base esta mal.
 *
 * Cada busqueda deja su paso en el run con los fragmentos usados, y el costo
 * del embedding de la consulta entra al mismo run.
 */

type Db = SupabaseClient<Database>;

export interface KnowledgeChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  similarity: number;
}

export type KnowledgeSearchResult =
  | { ok: true; chunks: KnowledgeChunk[] }
  | { ok: false; problem: string };

export async function searchKnowledge(
  supabase: Db,
  args: {
    workspaceId: string;
    query: string;
    tags: string[];
    matchCount: number;
    minSimilarity: number;
    run: AiRunHandle;
  },
): Promise<KnowledgeSearchResult> {
  const startedAt = Date.now();
  const embedded = await embedQuery(args.workspaceId, args.query, { supabase });

  if (!embedded.ok) {
    await args.run.step({
      kind: "kb_search",
      name: "buscar_en_conocimiento",
      input: { consulta: args.query },
      durationMs: Date.now() - startedAt,
      error: embedded.problem,
    });
    return { ok: false, problem: embedded.problem };
  }

  args.run.addEmbeddingUsage({ provider: "voyage", model: embedded.model, tokens: embedded.totalTokens });

  const { data, error } = await supabase.rpc("match_knowledge_chunks_filtered", {
    p_workspace_id: args.workspaceId,
    p_query_embedding: toPgVector(embedded.embedding),
    p_match_count: args.matchCount,
    p_min_similarity: args.minSimilarity,
    p_tags: args.tags.length > 0 ? args.tags : null,
    // El agente de leads nunca lee lo interno. No es configurable a proposito.
    p_include_internal: false,
  });

  if (error) {
    console.error("[agent-kb] fallo la busqueda semantica:", error.message);
    await args.run.step({
      kind: "kb_search",
      name: "buscar_en_conocimiento",
      input: { consulta: args.query },
      durationMs: Date.now() - startedAt,
      error: "search_failed",
    });
    return { ok: false, problem: "search_failed" };
  }

  const chunks: KnowledgeChunk[] = (data ?? []).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    content: row.content,
    similarity: Number(row.similarity),
  }));

  await args.run.step({
    kind: "kb_search",
    name: "buscar_en_conocimiento",
    input: { consulta: args.query, tags: args.tags },
    // Documento + fragmento de cada resultado: es lo que permite saber si
    // contesto mal por el prompt o porque el documento esta mal escrito.
    output: chunks.map((c) => ({
      documento: c.documentTitle,
      document_id: c.documentId,
      chunk_id: c.chunkId,
      similitud: Math.round(c.similarity * 1000) / 1000,
    })),
    kbChunkIds: chunks.map((c) => c.chunkId),
    durationMs: Date.now() - startedAt,
  });

  return { ok: true, chunks };
}
