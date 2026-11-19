import { embedQuery } from "@/lib/knowledge/embeddings";
import { toPgVector } from "@/lib/knowledge/voyage";
import { citationLabel } from "@/lib/knowledge/pages";
import type { PersonToolContext } from "@/lib/ai-tools/types";

/**
 * La búsqueda en Conocimiento del asistente del equipo (punto 13). La consulta se convierte en vector con la clave del
 * negocio (cliente de servicio: la clave de Voyage vive en Vault) y la búsqueda corre con la SESIÓN de la persona
 * (`match_knowledge_chunks_scoped`, 00443): la base decide qué documentos ve, solo los listos y nunca los internos.
 * Cada fragmento vuelve con su documento y su página, para que el asistente cite de dónde sale lo que responde.
 */

export interface PersonKnowledgeChunk {
  documento: string;
  pagina: number | null;
  cita: string;
  texto: string;
}

export type PersonKnowledgeResult =
  | { ok: true; chunks: PersonKnowledgeChunk[] }
  | { ok: false; code: "failed" | "no_access"; message: string };

const MATCH_COUNT = 6;
const MIN_SIMILARITY = 0.3;
const MAX_CHARS = 1500;

export async function searchKnowledgeForPerson(ctx: PersonToolContext, query: string): Promise<PersonKnowledgeResult> {
  const embedded = await embedQuery(ctx.workspaceId, query, { supabase: ctx.service as never });
  if (!embedded.ok) {
    return { ok: false, code: "failed", message: "No pude buscar en Conocimiento: revisá que la conexión de Voyage esté cargada." };
  }
  ctx.run?.addEmbeddingUsage({ provider: "voyage", model: embedded.model, tokens: embedded.totalTokens });

  const { data, error } = await ctx.supabase.rpc("match_knowledge_chunks_scoped", {
    p_workspace_id: ctx.workspaceId,
    p_query_embedding: toPgVector(embedded.embedding),
    p_match_count: MATCH_COUNT,
    p_min_similarity: MIN_SIMILARITY,
    p_tags: null,
    p_document_ids: null,
    p_folder_ids: null,
    p_include_internal: false,
  });
  if (error) {
    console.error("[ai-tools] fallo la busqueda en Conocimiento:", error.message);
    return { ok: false, code: "failed", message: "No pude buscar en Conocimiento ahora. Probá de nuevo en un rato." };
  }
  const rows = (data ?? []) as Array<{ chunk_id: string; document_title: string; content: string }>;
  const pages = await pagesOf(ctx, rows.map((r) => r.chunk_id));
  return {
    ok: true,
    chunks: rows.map((r) => {
      const page = pages.get(r.chunk_id) ?? null;
      return { documento: r.document_title, pagina: page, cita: citationLabel(r.document_title, [page]), texto: r.content.slice(0, MAX_CHARS) };
    }),
  };
}

async function pagesOf(ctx: PersonToolContext, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const { data, error } = await ctx.supabase.from("knowledge_chunks").select("id, page").in("id", ids);
  if (error) return out;
  for (const row of (data ?? []) as Array<{ id: string; page: number | null }>) {
    if (typeof row.page === "number") out.set(row.id, row.page);
  }
  return out;
}
