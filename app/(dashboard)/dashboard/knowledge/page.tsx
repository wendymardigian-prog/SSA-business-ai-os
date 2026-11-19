import { requirePermission } from "@/lib/auth/guards";
import { isEmbeddingProviderConnected } from "@/lib/knowledge/embeddings";
import { listFolders } from "@/lib/knowledge/folders";
import { KnowledgeView } from "./knowledge-view";
import type { KnowledgeStatus } from "@/lib/types/database";

/**
 * Base de conocimiento (F17), con carpetas y enlaces (00443).
 *
 * Pide `knowledge.view` (y editar, `knowledge.edit`), ademas de la RLS de knowledge_base.
 *
 * No se trae content_md en el listado. Es el campo mas pesado de la tabla —el
 * documento entero— y en la lista no se muestra: se lee en el detalle.
 */
export default async function KnowledgePage() {
  const { workspace, supabase, can } = await requirePermission("knowledge.view");

  const [{ data: documents, error }, voyageConnected, folders] = await Promise.all([
    supabase
      .from("knowledge_base")
      .select(
        "id, title, tags, internal_only, status, error_detail, chunk_count, source_mime, source_size_bytes, created_at, indexed_at, folder_id, source_kind, source_url",
      )
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    isEmbeddingProviderConnected(workspace.id, supabase),
    listFolders(supabase, workspace.id),
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
        internalOnly: Boolean(d.internal_only),
        mime: d.source_mime,
        sizeBytes: d.source_size_bytes,
        createdAt: d.created_at,
        indexedAt: d.indexed_at,
        folderId: d.folder_id ?? null,
        sourceKind: d.source_kind ?? "file",
        sourceUrl: d.source_url ?? null,
      }))}
      folders={folders}
      canEdit={can("knowledge.edit")}
      voyageConnected={voyageConnected}
    />
  );
}
