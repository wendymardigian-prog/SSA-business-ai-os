import { requireWorkspaceAdmin } from "@/lib/auth/guards";
import { isEmbeddingProviderConnected } from "@/lib/knowledge/embeddings";
import { KnowledgeView } from "./knowledge-view";
import type { KnowledgeStatus } from "@/lib/types/database";

/**
 * Base de conocimiento (F17).
 *
 * Solo Owner/Admin: requireWorkspaceAdmin ademas de la RLS de knowledge_base.
 *
 * No se trae content_md en el listado. Es el campo mas pesado de la tabla —el
 * documento entero— y en la lista no se muestra: se lee en el detalle.
 */
export default async function KnowledgePage() {
  const { workspace, supabase } = await requireWorkspaceAdmin();

  const [{ data: documents, error }, voyageConnected] = await Promise.all([
    supabase
      .from("knowledge_base")
      .select(
        "id, title, tags, status, error_detail, chunk_count, source_mime, source_size_bytes, created_at, indexed_at",
      )
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    isEmbeddingProviderConnected(workspace.id, supabase),
  ]);

  if (error) console.error("[kb] listado fallido:", error.message);

  return (
    <KnowledgeView
      documents={(documents ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        tags: d.tags ?? [],
        status: d.status as KnowledgeStatus,
        errorDetail: d.error_detail,
        chunkCount: d.chunk_count ?? 0,
        mime: d.source_mime,
        sizeBytes: d.source_size_bytes,
        createdAt: d.created_at,
        indexedAt: d.indexed_at,
      }))}
      voyageConnected={voyageConnected}
    />
  );
}
