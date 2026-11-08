/**
 * Los adjuntos de «Enviar email» en una automatizacion: se bajan de Recursos UNA vez por paso (aunque el correo vaya a
 * varias personas) y viajan en base64 por el `attachments` del envio de emails.
 *
 * Solo servidor: lee el bucket con el cliente de servicio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { CHAT_MEDIA_BUCKET, extensionForMime, safeFilename } from "@/lib/chat-media/bucket";
import { FILE_KINDS } from "@/lib/response-assets/kind";
import { DESIGN_RENDERS_BUCKET } from "@/lib/designer/storage";
import { assetAttachments, isDesignAttachment, MAX_EMAIL_ATTACHMENT_BYTES, MAX_EMAIL_ATTACHMENTS, type AssetAttachmentRef, type EmailAttachmentRef } from "./attachment-limits";

export interface LoadedEmailAttachments {
  files: Array<{ filename: string; content: string }>;
  /** Los que no se pudieron adjuntar (borrados, sin archivo, o que se pasaban del tope), con su nombre. */
  missing: string[];
  /**
   * El PDF del diseño (F59) que se pidió y no se puede adjuntar: `missing` = no hay una generación en esta corrida (el
   * paso falla); `not_ready` = todavía se está armando (el paso espera). Sin pedirlo, no viene.
   */
  designProblem?: "missing" | "not_ready" | "failed";
}

/** El nombre del PDF de un diseño: el nombre del diseño, legible ("constancia-ana-perez.pdf"). */
function designPdfName(name: string): string {
  return `${safeFilename(name.replace(/\.[a-z0-9]{2,5}$/i, ""), "diseno")}.pdf`;
}

/**
 * Carga los adjuntos de un paso «Enviar email». Los recursos de la banca, como siempre; el PDF del diseño (F59), de la
 * generación de ESTA corrida (`design.id`, lo deja «Generar desde plantilla»), solo si es del negocio y está lista.
 */
export async function loadEmailAttachments(
  supabase: SupabaseClient<Database>,
  args: { workspaceId: string; refs: EmailAttachmentRef[]; designId?: string | null },
): Promise<LoadedEmailAttachments> {
  const loaded = await loadAssetAttachments(supabase, { workspaceId: args.workspaceId, refs: assetAttachments(args.refs) });
  if (!args.refs.some(isDesignAttachment)) return loaded;

  if (!args.designId) return { ...loaded, designProblem: "missing" };
  const { data: design, error } = await supabase
    .from("designs")
    .select("id, name, status, renders")
    .eq("id", args.designId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[email] no pude leer el diseño a adjuntar:", error.message);
    return { ...loaded, designProblem: "not_ready" };
  }
  if (!design) return { ...loaded, designProblem: "missing" };
  const row = design as { name: string; status: string; renders: { pdf_path?: unknown } | null };
  const pdfPath = typeof row.renders?.pdf_path === "string" ? row.renders.pdf_path : null;
  if (row.status !== "ready" || !pdfPath) return { ...loaded, designProblem: row.status === "failed" || row.status === "void" ? "failed" : "not_ready" };

  const { data: blob, error: downloadError } = await supabase.storage.from(DESIGN_RENDERS_BUCKET).download(pdfPath);
  if (downloadError || !blob) {
    console.error("[email] no pude bajar el PDF del diseño:", downloadError?.message ?? "sin archivo");
    return { ...loaded, designProblem: "not_ready" };
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  const total = loaded.files.reduce((sum, f) => sum + Buffer.byteLength(f.content, "base64"), 0);
  if (loaded.files.length >= MAX_EMAIL_ATTACHMENTS || total + bytes.byteLength > MAX_EMAIL_ATTACHMENT_BYTES) {
    return { ...loaded, missing: [...loaded.missing, row.name] };
  }
  return { ...loaded, files: [...loaded.files, { filename: designPdfName(row.name), content: bytes.toString("base64") }] };
}

/** Los recursos de la banca (lo de siempre, sin cambios: lo fija `attachments-characterization.test.ts`). */
async function loadAssetAttachments(
  supabase: SupabaseClient<Database>,
  args: { workspaceId: string; refs: AssetAttachmentRef[] },
): Promise<LoadedEmailAttachments> {
  const refs = args.refs.slice(0, MAX_EMAIL_ATTACHMENTS);
  const missing = args.refs.slice(MAX_EMAIL_ATTACHMENTS).map((r) => r.name ?? "un adjunto");
  if (refs.length === 0) return { files: [], missing };

  const { data: rows, error } = await supabase
    .from("response_assets")
    .select("id, name, storage_path, mime_type, size_bytes")
    .eq("workspace_id", args.workspaceId)
    .in("id", refs.map((r) => r.assetId))
    .in("kind", [...FILE_KINDS])
    // Uno desactivado no sale: el panel ya no lo ofrece y el resto de los envíos tampoco lo manda.
    .eq("is_active", true)
    .is("deleted_at", null);
  if (error) {
    console.error("[email] no pude leer los recursos adjuntos:", error.message);
    return { files: [], missing: [...missing, ...refs.map((r) => r.name ?? "un adjunto")] };
  }

  const byId = new Map((rows ?? []).map((r) => [r.id as string, r as { id: string; name: string; storage_path: string | null; mime_type: string | null; size_bytes: number | null }]));
  const files: LoadedEmailAttachments["files"] = [];
  let total = 0;
  for (const ref of refs) {
    const row = byId.get(ref.assetId);
    if (!row?.storage_path) {
      missing.push(ref.name ?? "un adjunto");
      continue;
    }
    const { data: blob, error: downloadError } = await supabase.storage.from(CHAT_MEDIA_BUCKET).download(row.storage_path);
    if (downloadError || !blob) {
      console.error("[email] no pude bajar un adjunto:", downloadError?.message ?? "sin archivo");
      missing.push(row.name);
      continue;
    }
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (total + bytes.byteLength > MAX_EMAIL_ATTACHMENT_BYTES) {
      missing.push(row.name);
      continue;
    }
    total += bytes.byteLength;
    const ext = extensionForMime(row.mime_type);
    const base = safeFilename(row.name.replace(/\.[a-z0-9]{2,5}$/i, ""), "adjunto");
    files.push({ filename: `${base}.${ext}`, content: bytes.toString("base64") });
  }
  return { files, missing };
}
