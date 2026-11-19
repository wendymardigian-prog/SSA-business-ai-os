import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { AiRunHandle } from "@/lib/ai/run";
import { embedQuery } from "@/lib/knowledge/embeddings";
import { toPgVector } from "@/lib/knowledge/voyage";

/**
 * Busqueda en la base de conocimiento para el agente (F27).
 *
 * El filtro de acceso (tags permitidos, documentos internal_only) va DENTRO de
 * la consulta SQL: match_knowledge_chunks_scoped (00412; antes _filtered, 00062). Un documento
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
  /** : página del PDF donde empieza el trozo; null si el documento no tiene páginas. */
  page: number | null;
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
    /** : documentos y carpetas permitidos. Con `tags`: las tres vacías = toda la base. */
    documentIds?: string[];
    folderIds?: string[];
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

  const documentIds = args.documentIds ?? [];
  const folderIds = args.folderIds ?? [];
  // 00412: con alcance por documento y carpeta, y solo sobre documentos `ready`
  // (: un documento que se está reindexando nunca se cita con su versión vieja).
  const { data, error } = await supabase.rpc("match_knowledge_chunks_scoped", {
    p_workspace_id: args.workspaceId,
    p_query_embedding: toPgVector(embedded.embedding),
    p_match_count: args.matchCount,
    p_min_similarity: args.minSimilarity,
    p_tags: args.tags.length > 0 ? args.tags : null,
    p_document_ids: documentIds.length > 0 ? documentIds : null,
    p_folder_ids: folderIds.length > 0 ? folderIds : null,
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

  // : la página de cada trozo, aparte y por id (la búsqueda no cambia). Si no se puede leer, sin página.
  const pageById = await chunkPages(supabase, (data ?? []).map((row) => row.chunk_id));
  const chunks: KnowledgeChunk[] = (data ?? []).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    content: row.content,
    similarity: Number(row.similarity),
    page: pageById.get(row.chunk_id) ?? null,
  }));

  await args.run.step({
    kind: "kb_search",
    name: "buscar_en_conocimiento",
    input: { consulta: args.query, tags: args.tags, documentos: documentIds.length, carpetas: folderIds.length },
    // Documento + fragmento de cada resultado: es lo que permite saber si
    // contesto mal por el prompt o porque el documento esta mal escrito.
    output: chunks.map((c) => ({
      documento: c.documentTitle,
      document_id: c.documentId,
      chunk_id: c.chunkId,
      pagina: c.page,
      similitud: Math.round(c.similarity * 1000) / 1000,
    })),
    kbChunkIds: chunks.map((c) => c.chunkId),
    durationMs: Date.now() - startedAt,
  });

  return { ok: true, chunks };
}

async function chunkPages(supabase: Parameters<typeof searchKnowledge>[0], ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from("knowledge_chunks").select("id, page").in("id", ids);
  if (error) {
    console.error("[agent-kb] no pude leer las paginas de los fragmentos:", error.message);
    return out;
  }
  for (const row of (data ?? []) as Array<{ id: string; page: number | null }>) {
    if (typeof row.page === "number") out.set(row.id, row.page);
  }
  return out;
}
