/**
 * Vincula UN comentario guardado con su contacto y anota el toque de contenido (Extra I, F32).
 *
 * Lo comparten los dos caminos que unen un comentario con una persona:
 *   - `attributeComment` (`lib/comments/attribution.ts`): cuando llega el comentario y el autor ya es (o pasa a ser) contacto;
 *   - el job `comment_backfill` (`lib/jobs/handlers/comment-backfill.ts`): cuando un contacto gana su usuario de Instagram
 *     o TikTok DESPUÉS de haber comentado.
 *
 * Los dos usan la MISMA clave de deduplicación del toque (`comment:<id externo>`): correr el job dos veces, o llegar por los
 * dos caminos, deja un solo toque. Como `record_contact_touch` recalcula el primero y el último desde la tabla, un comentario
 * anterior al primer toque del contacto pasa a ser su primer toque: es lo esperado (es el primer contacto real).
 *
 * NUNCA lanza. `supabase` es el cliente de servicio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordTouch } from "@/lib/contacts/touch";
import type { Database, SocialPlatform } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** Una línea del caption para nombrar la pieza cuando no hay título. */
const snippet = (text: string | null): string | null => {
  const line = (text ?? "").split("\n").find((l) => l.trim());
  return line ? line.trim().slice(0, 80) : null;
};

/**
 * La pieza que se comentó, en palabras y en ids: el id del post de contenido (si salió de este sistema) y un nombre para
 * mostrar.
 */
export async function pieceOf(supabase: Db, socialPostId: string): Promise<{ contentPostId: string | null; label: string | null }> {
  const { data: publication } = await supabase.from("social_posts").select("content_post_id, caption").eq("id", socialPostId).maybeSingle();
  if (!publication) return { contentPostId: null, label: null };

  let title: string | null = null;
  if (publication.content_post_id) {
    const { data: piece } = await supabase.from("content_posts").select("title").eq("id", publication.content_post_id).maybeSingle();
    title = piece?.title?.trim() || null;
  }
  return { contentPostId: publication.content_post_id ?? null, label: title ?? snippet(publication.caption) };
}

export interface LinkableComment {
  platform: string;
  /** El id del comentario EN LA RED. */
  externalCommentId: string;
  commentedAt: string | null;
  /** La publicación comentada, si se conoce. */
  socialPostId: string | null;
  /** El id del anuncio de Meta si el comentario es sobre contenido pago. */
  adId?: string | null;
  /** Solo vincula si el comentario todavía no tiene contacto (el job de vínculo retroactivo). */
  onlyIfUnlinked?: boolean;
}

export interface LinkResult {
  /** El comentario quedó vinculado a ese contacto en esta llamada. */
  linked: boolean;
  /** Quedó un toque nuevo. */
  touched: boolean;
}

export async function linkCommentToContact(
  supabase: Db,
  args: { workspaceId: string; contactId: string; comment: LinkableComment },
): Promise<LinkResult> {
  const { workspaceId, contactId, comment } = args;
  let linked = false;
  try {
    // Se busca por el único de la tabla (workspace, red e id externo): quien llama tiene el id de la red, no el de nuestra fila.
    let update = supabase
      .from("social_post_comments")
      .update({ contact_id: contactId })
      .eq("workspace_id", workspaceId)
      .eq("platform", comment.platform as SocialPlatform)
      .eq("external_comment_id", comment.externalCommentId);
    if (comment.onlyIfUnlinked) update = update.is("contact_id", null);
    const { data, error: linkError } = await update.select("id");
    if (linkError) {
      console.error("[atribucion] no pude vincular el comentario al contacto:", linkError.message);
    } else {
      linked = (data ?? []).length > 0;
    }
    if (comment.onlyIfUnlinked && !linked) return { linked: false, touched: false };

    const piece = comment.socialPostId ? await pieceOf(supabase, comment.socialPostId) : null;
    const adId = comment.adId?.trim() || null;
    const result = await recordTouch(supabase, {
      workspaceId,
      contactId,
      touch: {
        occurredAt: comment.commentedAt,
        source: comment.platform,
        // Un comentario sobre un anuncio viene de la publicidad: medio paid_social y el ad_id al toque.
        medium: adId ? "paid_social" : "comment",
        origin: "comment",
        dedupeKey: `comment:${comment.externalCommentId}`,
        content: piece?.label ?? null,
        adId,
        socialPostId: comment.socialPostId,
        contentPostId: piece?.contentPostId ?? null,
        raw: { comment_id: comment.externalCommentId, platform: comment.platform },
      },
    });
    return { linked, touched: result.recorded };
  } catch (err) {
    console.error("[atribucion] fallo el vinculo del comentario:", err instanceof Error ? err.message : String(err));
    return { linked, touched: false };
  }
}
