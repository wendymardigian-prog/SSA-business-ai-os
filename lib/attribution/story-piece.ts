/**
 * La pieza de una historia propia (Extra I, F33). Alguien responde a una historia nuestra: si esa historia salió de este
 * sistema (o se marcó a mano) hay una fila en `social_posts` con el id de la historia en `external_post_id`, y de ahí
 * sale la pieza.
 *
 * Defensivo a propósito: el id de una historia en Zernio puede no coincidir con el `external_post_id` guardado (no está
 * verificado en vivo, ver PENDIENTE). Solo se resuelve si hay UNA fila en el workspace para esa red; con cero o con más
 * de una devuelve null y el toque queda como siempre. NUNCA lanza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export interface StoryPiece {
  socialPostId: string;
  contentPostId: string | null;
  /** El título de la pieza (o el principio del caption si no tiene pieza). */
  title: string | null;
}

export async function resolveStoryPiece(
  db: SupabaseClient<Database>,
  args: { workspaceId: string; platform: string; storyId: string | null | undefined },
): Promise<StoryPiece | null> {
  try {
    const storyId = typeof args.storyId === "string" ? args.storyId.trim() : "";
    if (!storyId) return null;
    const { data, error } = await db
      .from("social_posts")
      .select("id, content_post_id, caption")
      .eq("workspace_id", args.workspaceId)
      .eq("platform", args.platform as Database["public"]["Tables"]["social_posts"]["Row"]["platform"])
      .eq("external_post_id", storyId)
      .is("deleted_at", null)
      .limit(2);
    if (error || !data || data.length !== 1) return null;
    const row = data[0] as { id: string; content_post_id: string | null; caption: string | null };

    let title: string | null = null;
    if (row.content_post_id) {
      const { data: piece } = await db.from("content_posts").select("title").eq("id", row.content_post_id).maybeSingle();
      title = (piece as { title?: string | null } | null)?.title?.trim() || null;
    }
    if (!title) title = (row.caption ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 80) ?? null;
    return { socialPostId: row.id, contentPostId: row.content_post_id ?? null, title };
  } catch {
    return null;
  }
}
