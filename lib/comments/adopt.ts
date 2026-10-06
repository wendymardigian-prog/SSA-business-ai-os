/**
 * Adoptar comentarios huérfanos (F76).
 *
 * Un comentario entra por el webhook antes de que exista la publicación o la
 * cuenta social de la que cuelga, y se guarda sin `social_post_id`. Esto lo
 * vincula cuando la publicación aparece, comparando el id del post en la red
 * (`external_post_id`) de los dos lados.
 *
 * Reglas:
 *  - **Solo vincula, nunca crea publicaciones.** Crear una fila `external` por
 *    cada id suelto ensuciaría Social con posts sin título ni métricas; lo hace
 *    `storeComment` cuando el comentario llega con una cuenta conectada.
 *  - **Idempotente.** Correrla dos veces no cambia nada la segunda: el UPDATE
 *    solo toca filas que siguen huérfanas.
 *  - **Un comentario sin `external_post_id` se saltea sin error.** Los 167 de
 *    antes de la 00113 no lo tienen; los completa la relectura de Zernio.
 *  - **Nunca lanza.** Es un arreglo a posteriori: si falla, se loguea y el
 *    llamador (sincronizar cuentas, el job de métricas) sigue.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SocialPlatform } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

/** Cuántos huérfanos se miran por corrida: el resto queda para la siguiente. */
const BATCH = 500;

export interface AdoptResult {
  /** Comentarios que quedaron vinculados a una publicación. */
  adopted: number;
  /** Huérfanos que no se pueden adoptar todavía: no traen `external_post_id`. */
  withoutPostId: number;
  /** Huérfanos con id de post cuya publicación todavía no existe. */
  waiting: number;
}

export async function adoptOrphanComments(
  supabase: Db,
  workspaceId: string,
  platform: SocialPlatform,
): Promise<AdoptResult> {
  const result: AdoptResult = { adopted: 0, withoutPostId: 0, waiting: 0 };

  try {
    const { data: orphans, error } = await supabase
      .from("social_post_comments")
      .select("id, external_post_id")
      .eq("workspace_id", workspaceId)
      .eq("platform", platform)
      .is("social_post_id", null)
      .is("deleted_at", null)
      .limit(BATCH);

    if (error) {
      console.error("[comentarios] no pude leer los huerfanos:", error.message);
      return result;
    }

    const byPost = new Map<string, string[]>();
    for (const row of orphans ?? []) {
      if (!row.external_post_id) {
        result.withoutPostId += 1;
        continue;
      }
      const ids = byPost.get(row.external_post_id) ?? [];
      ids.push(row.id);
      byPost.set(row.external_post_id, ids);
    }
    if (byPost.size === 0) return result;

    const { data: posts, error: postsError } = await supabase
      .from("social_posts")
      .select("id, external_post_id")
      .eq("workspace_id", workspaceId)
      .eq("platform", platform)
      .is("deleted_at", null)
      .in("external_post_id", [...byPost.keys()]);

    if (postsError) {
      console.error("[comentarios] no pude buscar las publicaciones:", postsError.message);
      return result;
    }

    const postByExternalId = new Map<string, string>();
    for (const post of posts ?? []) {
      if (post.external_post_id) postByExternalId.set(post.external_post_id, post.id);
    }

    for (const [externalPostId, commentIds] of byPost) {
      const socialPostId = postByExternalId.get(externalPostId);
      if (!socialPostId) {
        result.waiting += commentIds.length;
        continue;
      }

      // `.is("social_post_id", null)`: si otra corrida ya lo adoptó, no se pisa.
      const { data: updated, error: updateError } = await supabase
        .from("social_post_comments")
        .update({ social_post_id: socialPostId })
        .in("id", commentIds)
        .is("social_post_id", null)
        .select("id");

      if (updateError) {
        console.error("[comentarios] no pude adoptar:", updateError.message);
        continue;
      }
      result.adopted += updated?.length ?? 0;
    }

    return result;
  } catch (err) {
    console.error("[comentarios] adoptar huerfanos fallo:", err instanceof Error ? err.message : String(err));
    return result;
  }
}
