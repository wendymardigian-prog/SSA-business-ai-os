/**
 * La atribución de un comentario (F86).
 *
 * Cuando alguien comenta una publicación y esa persona es (o pasa a ser) un
 * contacto, ese comentario es un toque: el origen de la relación puede ser "te
 * vi comentando el reel de dólares". Esto vincula el comentario con su contacto
 * y anota ese toque con la pieza concreta.
 *
 * Dos reglas que NO son obvias:
 *
 * 1. **Instagram no crea contactos desde un comentario.** Solo se vincula si la
 *    persona ya es contacto, o si la automatización por palabra clave lo creó
 *    (por eso se llama dos veces: antes y después de `processComment`). Crear un
 *    contacto por cada comentarista llenaría el CRM de gente que solo opinó y
 *    dispararía "contacto nuevo" para cada uno. Un lead es quien levanta la
 *    mano, no quien pasa.
 * 2. **TikTok sí crea un contacto anónimo.** No tiene canal ni mensajes
 *    directos: el comentario es la única señal que va a haber. El contacto nace
 *    anónimo (con su `tiktok_username`), que el sistema ya sabe ocultar de las
 *    listas y no cuenta como "contacto nuevo". El día que escriba por otro canal,
 *    `find_or_link_contact` lo unifica.
 *
 * Los comentarios PROPIOS no crean contacto ni toque, y esto no toca
 * `processComment` ni las automatizaciones.
 *
 * **NUNCA lanza**: el comentario ya está guardado y la automatización corre
 * aparte. Una estadística no puede frenar nada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SocialPlatform } from "@/lib/types/database";
import { recordTouch } from "@/lib/contacts/touch";

type Db = SupabaseClient<Database>;

/** En qué columna vive el usuario de cada red (las dos con comentarios). */
const USERNAME_COLUMN = {
  instagram: "instagram_username",
  tiktok: "tiktok_username",
} as const;

/**
 * El nombre con el que nace un contacto que solo comentó. Es uno de los
 * marcadores que la columna generada `is_anonymous` reconoce (00032): por eso
 * queda anónimo, y por eso este texto no se puede cambiar a la ligera.
 */
const ANONYMOUS_NAME = "Unknown commenter";

export interface CommentAttributionParams {
  workspaceId: string;
  platform: string;
  /** El id del comentario EN LA RED. */
  externalCommentId: string;
  authorUsername: string | null;
  isOwn: boolean;
  commentedAt: string | null;
  /** La publicación comentada, si se conoce. Null = comentario huérfano. */
  socialPostId: string | null;
}

export interface CommentAttributionResult {
  contactId: string | null;
  /** Se creó un contacto anónimo (solo TikTok). */
  createdContact: boolean;
  /** Quedó un toque nuevo. */
  touched: boolean;
}

const NOTHING: CommentAttributionResult = { contactId: null, createdContact: false, touched: false };

/** Una línea del caption para nombrar la pieza cuando no hay título. */
const snippet = (text: string | null): string | null => {
  const line = (text ?? "").split("\n").find((l) => l.trim());
  return line ? line.trim().slice(0, 80) : null;
};

async function findContactId(
  supabase: Db,
  workspaceId: string,
  column: "instagram_username" | "tiktok_username",
  username: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq(column, username)
    .is("deleted_at", null)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * La pieza que se comentó, en palabras y en ids: el id del post de contenido (si
 * salió de este sistema) y un nombre para mostrar.
 */
async function pieceOf(
  supabase: Db,
  socialPostId: string,
): Promise<{ contentPostId: string | null; label: string | null }> {
  const { data: publication } = await supabase
    .from("social_posts")
    .select("content_post_id, caption")
    .eq("id", socialPostId)
    .maybeSingle();

  if (!publication) return { contentPostId: null, label: null };

  let title: string | null = null;
  if (publication.content_post_id) {
    const { data: piece } = await supabase
      .from("content_posts")
      .select("title")
      .eq("id", publication.content_post_id)
      .maybeSingle();
    title = piece?.title?.trim() || null;
  }

  return { contentPostId: publication.content_post_id ?? null, label: title ?? snippet(publication.caption) };
}

/**
 * Vincula el comentario con su contacto y anota el toque. `supabase` es el
 * cliente de servicio. Idempotente: se puede llamar antes y después de
 * `processComment` sin duplicar nada (el toque se deduplica por el id del
 * comentario).
 */
export async function attributeComment(
  supabase: Db,
  params: CommentAttributionParams,
): Promise<CommentAttributionResult> {
  try {
    if (params.isOwn) return NOTHING;

    const column = USERNAME_COLUMN[params.platform as keyof typeof USERNAME_COLUMN];
    const username = params.authorUsername?.trim();
    if (!column || !username) return NOTHING;

    let contactId = await findContactId(supabase, params.workspaceId, column, username);
    let createdContact = false;

    if (!contactId && params.platform === "tiktok") {
      const { data, error } = await supabase
        .from("contacts")
        .insert({
          workspace_id: params.workspaceId,
          display_name: ANONYMOUS_NAME,
          tiktok_username: username,
          last_interaction_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();

      if (error || !data) {
        console.error("[atribucion] no pude crear el contacto del comentario:", error?.message);
        return NOTHING;
      }
      contactId = data.id;
      createdContact = true;
    }

    if (!contactId) return NOTHING;

    // Se busca por el único de la tabla (workspace, red e id externo): quien
    // llama tiene el id de la red, no el de nuestra fila.
    const { error: linkError } = await supabase
      .from("social_post_comments")
      .update({ contact_id: contactId })
      .eq("workspace_id", params.workspaceId)
      .eq("platform", params.platform as SocialPlatform)
      .eq("external_comment_id", params.externalCommentId);
    if (linkError) {
      console.error("[atribucion] no pude vincular el comentario al contacto:", linkError.message);
    }

    const piece = params.socialPostId ? await pieceOf(supabase, params.socialPostId) : null;

    const result = await recordTouch(supabase, {
      workspaceId: params.workspaceId,
      contactId,
      touch: {
        occurredAt: params.commentedAt,
        source: params.platform,
        medium: "comment",
        origin: "comment",
        dedupeKey: `comment:${params.externalCommentId}`,
        content: piece?.label ?? null,
        socialPostId: params.socialPostId,
        contentPostId: piece?.contentPostId ?? null,
        raw: { comment_id: params.externalCommentId, platform: params.platform },
      },
    });

    return { contactId, createdContact, touched: result.recorded };
  } catch (err) {
    console.error("[atribucion] fallo la atribucion del comentario:", err instanceof Error ? err.message : String(err));
    return NOTHING;
  }
}
