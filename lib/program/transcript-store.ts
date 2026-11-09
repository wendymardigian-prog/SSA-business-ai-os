// @plantilla-quitar(servicios)
import type { PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { svcSchema } from "@/lib/services/db";
import { chunkTranscript } from "@/lib/program/transcript";
import { indexText } from "@/lib/knowledge/index-text";

/**
 * Guarda la transcripción de una clase en Conocimiento (F49, F65), visible para el tutor (no interna), con el segundo
 * en que empieza cada parte (`knowledge_chunks.start_second`). Reemplaza la anterior de la misma clase. Quien llama ya
 * comprobó su permiso; la clase se busca con la sesión (la RLS de `program_items`) y del negocio de la sesión.
 */
export async function saveLessonTranscriptCore(
  ctx: Pick<PermissionContext, "supabase" | "workspace" | "user">,
  productId: string,
  itemId: string,
  text: string,
  format: "vtt" | "srt" | "txt",
): Promise<{ ok: true; status: string; chunks: number } | { ok: false; reason: "empty" | "not_found" }> {
  const raw = text.slice(0, 2_000_000);
  const chunks = chunkTranscript(raw);
  if (chunks.length === 0) return { ok: false, reason: "empty" };
  const { data: item } = await svcSchema(ctx.supabase).from("program_items").select("id, title").eq("id", itemId).eq("product_id", productId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!item) return { ok: false, reason: "not_found" };
  const service = await createServiceClient();
  const { data: prev } = await service.from("knowledge_base").select("id").eq("workspace_id", ctx.workspace.id).eq("program_item_id" as never, itemId as never).maybeSingle();
  const out = await indexText(service, {
    workspaceId: ctx.workspace.id,
    title: `Clase: ${(item as { title: string }).title}`,
    tags: ["programa", `programa:${productId}`],
    internalOnly: false,
    sourceFilename: `transcripcion.${format}`,
    sourceMime: format === "txt" ? "text/plain" : "text/vtt",
    contentMd: chunks.map((c) => c.text).join("\n\n"),
    chunks: chunks.map((c) => c.text),
    replaceDocumentId: (prev as { id?: string } | null)?.id ?? null,
    createdBy: ctx.user.id,
  });
  if (out.documentId) {
    await service.from("knowledge_base").update({ program_item_id: itemId } as never).eq("id", out.documentId);
    if (out.status === "ready") {
      for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].startSecond === null) continue;
        await service.from("knowledge_chunks").update({ start_second: chunks[i].startSecond } as never).eq("document_id", out.documentId).eq("chunk_index", i);
      }
    }
  }
  return { ok: true, status: out.status, chunks: out.chunks };
}
