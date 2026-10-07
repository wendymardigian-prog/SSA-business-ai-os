/**
 * Guardar una version, sin depender de que haya alguien mirando (E5).
 *
 * El historial lo escribe el servidor con el service client: la tabla solo
 * tiene policy de lectura (00083), a proposito, porque un historial que
 * alguien puede escribir a mano no sirve para volver atras.
 *
 * Esto vive aparte de la Server Action porque el copywriter corre en un job:
 * no hay sesion de la que sacar el usuario, y el autor es el agente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { decideVersionWrite } from "./autosave";
import {
  nextVersionNumber,
  versionReasonFor,
  versionsToPrune,
  type PostSnapshot,
  type SaveContext,
} from "./versions";

type Db = SupabaseClient<Database>;

export type SavedVersion =
  | { ok: true; saved: false }
  | { ok: true; saved: true; versionNo: number }
  | { ok: false; error: string };

export async function writeVersion(
  service: Db,
  input: {
    postId: string;
    workspaceId: string;
    context: SaveContext;
    authorKind?: "human" | "ai" | "system";
    /** Null cuando escribe el agente: no hay persona detras. */
    authorId?: string | null;
  },
): Promise<SavedVersion> {
  const reason = versionReasonFor(input.context);
  if (!reason) return { ok: true, saved: false };

  const { data: post } = await service
    .from("content_posts")
    .select("id, title, format, script, recording_notes, caption, networks, media, current_version")
    .eq("id", input.postId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  if (!post) return { ok: false, error: "No encontre esa pieza" };

  const snapshot: PostSnapshot = {
    title: post.title,
    format: post.format,
    script: post.script ?? null,
    recording_notes: post.recording_notes ?? null,
    caption: post.caption,
    networks: (Array.isArray(post.networks) ? post.networks : []) as unknown[],
    media: (Array.isArray(post.media) ? post.media : []) as unknown[],
  };

  const authorKind = input.authorKind ?? "human";
  const authorId = authorKind === "ai" ? null : (input.authorId ?? null);
  const now = input.context.now ?? new Date();

  // 'edit' agrupa por sesion (C6): un edit dentro de los 10 minutos del
  // mismo autor ACTUALIZA la ultima version en vez de crear otra. Los demas
  // motivos (cambio de estado, aprobar, IA, restaurar) siempre insertan: son
  // justo lo que corta la sesion.
  if (reason === "edit") {
    const { data: last } = await service
      .from("content_post_versions")
      .select("id, author_id, reason, updated_at")
      .eq("post_id", post.id)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    const mode = decideVersionWrite({
      last: last ? { authorId: last.author_id, reason: last.reason, updatedAt: last.updated_at } : null,
      authorId,
      now,
    });

    if (mode === "update" && last) {
      const { error } = await service
        .from("content_post_versions")
        .update({ snapshot: snapshot as never, updated_at: now.toISOString() })
        .eq("id", last.id);

      if (error) {
        console.error("[content] no pude actualizar la version de la sesion:", error.message);
        return { ok: false, error: "No pude guardar la version" };
      }

      return { ok: true, saved: true, versionNo: post.current_version ?? 0 };
    }
  }

  const versionNo = nextVersionNumber(post.current_version ?? 0);

  const { error } = await service.from("content_post_versions").insert({
    workspace_id: input.workspaceId,
    post_id: post.id,
    version_no: versionNo,
    snapshot: snapshot as never,
    author_kind: authorKind,
    author_id: authorId,
    reason,
    updated_at: now.toISOString(),
  });

  if (error) {
    console.error("[content] no pude guardar la version:", error.message);
    return { ok: false, error: "No pude guardar la version" };
  }

  await service.from("content_posts").update({ current_version: versionNo }).eq("id", post.id);

  // El recorte va DESPUES de guardar: perder la version nueva por limpiar
  // seria al reves de lo que se quiere.
  const { data: all } = await service
    .from("content_post_versions")
    .select("id, version_no")
    .eq("post_id", post.id);

  const extra = versionsToPrune(all ?? []);
  if (extra.length > 0) {
    await service.from("content_post_versions").delete().in("id", extra);
  }

  return { ok: true, saved: true, versionNo };
}
