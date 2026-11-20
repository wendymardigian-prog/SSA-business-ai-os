// @plantilla-quitar(servicios)
import { createServiceClient } from "@/lib/supabase/server";
import { svcSchema } from "@/lib/services/db";
import { chunkMarkdown } from "@/lib/knowledge/chunk";
import { indexText } from "@/lib/knowledge/index-text";
import { pageText } from "@/lib/program/page-text";

/**
 * Guarda el texto de la página HTML de una clase en Conocimiento, visible para el tutor (no interna), igual que la
 * transcripción de un video (`transcript-store.ts`). Así el Asistente IA puede leer una clase tipo página y la página
 * que va debajo de un video. Va atada a la clase (`program_item_id`) y se distingue de la transcripción por su nombre
 * de archivo (`pagina.html`): una clase de video puede tener las dos. Reemplaza la anterior; si la página quedó sin
 * texto, la saca de Conocimiento. Quien llama ya comprobó el permiso y que la clase es del negocio.
 */
export const PAGE_SOURCE_FILENAME = "pagina.html";

/** Las clases que el portal muestra con página: la tipo página y el video (con la página debajo). */
export const PAGE_LESSON_TYPES = ["html", "video"] as const;

export async function saveLessonPageCore(
  workspaceId: string,
  createdBy: string | null,
  productId: string,
  itemId: string,
): Promise<{ ok: true; status: string; chunks: number } | { ok: false; reason: "not_found" | "removed" }> {
  const service = await createServiceClient();
  const { data: item } = await svcSchema(service).from("program_items").select("id, title, lesson_type, html_content").eq("id", itemId).eq("product_id", productId).eq("workspace_id", workspaceId).maybeSingle();
  if (!item) return { ok: false, reason: "not_found" };
  const it = item as { title: string; lesson_type: string | null; html_content: string | null };
  const { data: prev } = await service
    .from("knowledge_base")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("program_item_id" as never, itemId as never)
    .eq("source_filename", PAGE_SOURCE_FILENAME)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  const prevId = (prev as { id?: string } | null)?.id ?? null;
  const text = (PAGE_LESSON_TYPES as readonly string[]).includes(it.lesson_type ?? "") ? pageText(it.html_content) : "";
  const chunks = chunkMarkdown(text).map((c) => c.content);
  if (chunks.length === 0) {
    if (prevId) await service.from("knowledge_base").update({ deleted_at: new Date().toISOString() }).eq("id", prevId).eq("workspace_id", workspaceId);
    return { ok: false, reason: "removed" };
  }
  const out = await indexText(service, {
    workspaceId,
    title: `Página: ${it.title}`,
    tags: ["programa", `programa:${productId}`],
    internalOnly: false,
    sourceFilename: PAGE_SOURCE_FILENAME,
    sourceMime: "text/html",
    contentMd: text,
    chunks,
    replaceDocumentId: prevId,
    createdBy,
  });
  if (out.documentId) await service.from("knowledge_base").update({ program_item_id: itemId } as never).eq("id", out.documentId);
  return { ok: true, status: out.status, chunks: out.chunks };
}

/** Lo mismo sin frenar a quien llama: si falla, se ve en el log y se vuelve a intentar al abrir el programa. */
export async function indexLessonPageQuietly(workspaceId: string, createdBy: string | null, productId: string, itemId: string): Promise<void> {
  await saveLessonPageCore(workspaceId, createdBy, productId, itemId).catch((e) => console.error("[pagina-tutor]", e instanceof Error ? e.message : "error"));
}
