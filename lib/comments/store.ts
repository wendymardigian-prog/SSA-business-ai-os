/**
 * Guardar comentarios (F46).
 *
 * Entran por dos caminos y terminan en la misma tabla:
 *
 *  - **El webhook**, en el momento. Es el que importa para contestar rapido.
 *  - **La relectura** del cron, que completa lo que el webhook no trajo (los
 *    de antes de conectar, los que Meta no entrego) y actualiza los likes.
 *
 * Dos cosas que hace distinto de lo que uno esperaria, y las dos a proposito:
 *
 * 1. **Los comentarios propios TAMBIEN se guardan.** El hilo tiene que leerse
 *    completo, con la respuesta del negocio adentro. Lo que no hacen es
 *    disparar automatizaciones: eso seria un bot contestandose solo.
 * 2. **Un comentario puede guardarse sin publicacion.** Llega antes de que la
 *    publicacion exista de nuestro lado (un post hecho a mano del que todavia
 *    no sincronizamos nada). Se guarda huerfano y la sincronizacion lo
 *    adopta. Descartarlo seria perder el comentario.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommentSource, Database, SocialPlatform } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export interface IncomingComment {
  platform: string;
  externalCommentId: string;
  parentExternalCommentId?: string | null;
  /** El id del post EN LA RED. Es con lo que se busca la publicacion. */
  externalPostId: string | null;
  authorExternalId?: string | null;
  authorUsername?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  isOwn: boolean;
  text: string | null;
  commentedAt: string | null;
  likeCount?: number | null;
  source: CommentSource;
}

/**
 * Si un comentario es nuestro.
 *
 * Por el nombre de usuario de la cuenta conectada, que es lo unico que
 * Zernio manda en el autor. Sin esto, la respuesta publica del flow
 * dispararia el mismo flow otra vez.
 */
export function isOwnComment(
  author: { id?: string | null; username?: string | null; isOwnAccount?: boolean } | null | undefined,
  account: { externalId?: string | null; username?: string | null },
): boolean {
  if (!author) return false;
  if (author.isOwnAccount === true) return true;
  if (author.username && account.username && author.username === account.username) return true;
  return Boolean(author.id && account.externalId && author.id === account.externalId);
}

export interface StoreResult {
  stored: boolean;
  /** Se creo la fila de la publicacion porque no existia. */
  createdPublication: boolean;
  socialPostId: string | null;
}

/**
 * Guarda un comentario, creando la publicacion externa si hace falta.
 *
 * Idempotente por el unico `(workspace_id, platform, external_comment_id)`:
 * el webhook y la relectura pueden traer el mismo y queda uno solo, con los
 * likes actualizados.
 */
export async function storeComment(
  supabase: Db,
  params: {
    workspaceId: string;
    socialAccountId: string | null;
    comment: IncomingComment;
  },
): Promise<StoreResult> {
  const { comment } = params;

  let socialPostId: string | null = null;
  let createdPublication = false;

  if (comment.externalPostId && params.socialAccountId) {
    const found = await findOrCreatePublication(supabase, {
      workspaceId: params.workspaceId,
      socialAccountId: params.socialAccountId,
      platform: comment.platform,
      externalPostId: comment.externalPostId,
    });
    socialPostId = found.id;
    createdPublication = found.created;
  }

  const { error } = await supabase.from("social_post_comments").upsert(
    {
      workspace_id: params.workspaceId,
      social_post_id: socialPostId,
      platform: comment.platform as SocialPlatform,
      external_comment_id: comment.externalCommentId,
      parent_external_comment_id: comment.parentExternalCommentId ?? null,
      author_external_id: comment.authorExternalId ?? null,
      author_username: comment.authorUsername ?? null,
      author_name: comment.authorName ?? null,
      author_avatar_url: comment.authorAvatarUrl ?? null,
      is_own: comment.isOwn,
      text: comment.text,
      commented_at: comment.commentedAt,
      like_count: comment.likeCount ?? null,
      source: comment.source,
    },
    { onConflict: "workspace_id,platform,external_comment_id" },
  );

  if (error) {
    console.error("[comentarios] no pude guardar:", error.message);
    return { stored: false, createdPublication, socialPostId };
  }

  return { stored: true, createdPublication, socialPostId };
}

/**
 * La publicacion de ese post, o una nueva marcada como externa.
 *
 * Un comentario sobre un post que no salio de este sistema igual tiene que
 * poder guardarse: la fila `external` es el lugar donde colgarlo, y la
 * proxima sincronizacion la completa con el caption y las metricas.
 */
export async function findOrCreatePublication(
  supabase: Db,
  params: {
    workspaceId: string;
    socialAccountId: string;
    platform: string;
    externalPostId: string;
  },
): Promise<{ id: string | null; created: boolean }> {
  const { data: existing } = await supabase
    .from("social_posts")
    .select("id")
    .eq("social_account_id", params.socialAccountId)
    .eq("external_post_id", params.externalPostId)
    .maybeSingle();

  if (existing) return { id: existing.id, created: false };

  const { data: created, error } = await supabase
    .from("social_posts")
    .insert({
      workspace_id: params.workspaceId,
      social_account_id: params.socialAccountId,
      platform: params.platform as SocialPlatform,
      external_post_id: params.externalPostId,
      // `external` y `status` null: nunca paso por nuestra cola.
      origin: "external",
      status: null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Otra corrida la pudo crear en el medio: se vuelve a buscar antes de
    // darla por perdida.
    const { data: raced } = await supabase
      .from("social_posts")
      .select("id")
      .eq("social_account_id", params.socialAccountId)
      .eq("external_post_id", params.externalPostId)
      .maybeSingle();
    if (raced) return { id: raced.id, created: false };

    console.error("[comentarios] no pude crear la publicacion externa:", error.message);
    return { id: null, created: false };
  }

  return { id: created?.id ?? null, created: true };
}

/** En que columna vive el nombre de usuario de cada red. */
const USERNAME_COLUMN: Record<string, "instagram_username" | "tiktok_username"> = {
  instagram: "instagram_username",
  tiktok: "tiktok_username",
};

/**
 * Vincula el comentario a un contacto conocido, si lo hay.
 *
 * Que la persona que comento sea la misma que escribe por DM es informacion
 * util: la ficha del contacto puede mostrar que comento tres veces esta
 * semana. Best-effort: no encontrarlo no es un error.
 */
export async function linkCommentToContact(
  supabase: Db,
  params: {
    workspaceId: string;
    /** El id del comentario EN LA RED, no el de nuestra fila. */
    externalCommentId: string;
    platform: string;
    authorUsername: string | null;
  },
): Promise<boolean> {
  // El nombre de usuario vive en una columna por red: en Instagram no puede
  // chocar con el mismo nombre en TikTok, que puede ser otra persona.
  const column = USERNAME_COLUMN[params.platform];
  if (!params.authorUsername || !column) return false;

  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", params.workspaceId)
    .eq(column, params.authorUsername)
    .is("deleted_at", null)
    .maybeSingle();

  if (!contact) return false;

  // Se busca por el unico de la tabla —workspace, red e id externo— y no
  // por el id de la fila: quien llama tiene el id de la red, que es el que
  // vino en el webhook. Pasarle ese id a una columna uuid no encontraba
  // nada y el contacto nunca se vinculaba.
  const { error } = await supabase
    .from("social_post_comments")
    .update({ contact_id: contact.id })
    .eq("workspace_id", params.workspaceId)
    .eq("platform", params.platform as SocialPlatform)
    .eq("external_comment_id", params.externalCommentId);

  return !error;
}
