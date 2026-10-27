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
import { MAX_EMAIL_ATTACHMENT_BYTES, MAX_EMAIL_ATTACHMENTS, type EmailAttachmentRef } from "./attachment-limits";

export interface LoadedEmailAttachments {
  files: Array<{ filename: string; content: string }>;
  /** Los que no se pudieron adjuntar (borrados, sin archivo, o que se pasaban del tope), con su nombre. */
  missing: string[];
}

export async function loadEmailAttachments(
  supabase: SupabaseClient<Database>,
  args: { workspaceId: string; refs: EmailAttachmentRef[] },
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
